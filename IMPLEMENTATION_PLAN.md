# File Check-In/Check-Out System - Implementation Plan

A Slack-integrated file management system with Git LFS versioning and exclusive checkout (locking) capabilities.

## Core Concept

Users interact with files entirely through Slack. Each **project has its own File Hub channel** (e.g., `#project-alpha-files`, `#project-beta-files`) serving as the single source of truth for that project's files. **Access control is based on Slack channel membership** - if you're in the hub channel, you can access those files. When files are shared elsewhere, **Reference Cards** appear that stay aware of version changes.

### Multi-Project Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SLACK WORKSPACE                                │
│                                                                             │
│  Project Alpha (Confidential)          Project Beta (Different Team)       │
│  ┌─────────────────────────┐           ┌─────────────────────────┐         │
│  │ #alpha-files (Hub)      │           │ #beta-files (Hub)       │         │
│  │ - design-spec.psd       │           │ - api-docs.pdf          │         │
│  │ - prototype.fig         │           │ - schema.sql            │         │
│  │ Members: @alice @bob    │           │ Members: @charlie @dana │         │
│  └─────────────────────────┘           └─────────────────────────┘         │
│           │                                       │                         │
│           │ Can share to                          │ Can share to            │
│           ▼                                       ▼                         │
│  ┌─────────────────────────┐           ┌─────────────────────────┐         │
│  │ #alpha-design (team)    │           │ #beta-engineering       │         │
│  │ Reference cards only    │           │ Reference cards only    │         │
│  └─────────────────────────┘           └─────────────────────────┘         │
│                                                                             │
│  ❌ @charlie cannot see #alpha-files or its reference cards                │
│  ❌ @alice cannot see #beta-files or its reference cards                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SLACK WORKSPACE                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ /files      │  │ Download    │  │ Check-in    │  │ Version     │        │
│  │ Command     │  │ Button      │  │ Modal       │  │ History     │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BOLT.JS APPLICATION                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Slack Event     │  │ File Service    │  │ Lock Service    │             │
│  │ Handlers        │  │                 │  │                 │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
└───────────┴────────────────────┴────────────────────┴───────────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
┌───────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│   PostgreSQL      │  │   Git LFS       │  │   Object Storage    │
│   (Metadata)      │  │   Repository    │  │   (S3/MinIO)        │
│   - Locks         │  │   - Pointers    │  │   - File Blobs      │
│   - Users         │  │   - History     │  │                     │
│   - Versions      │  │                 │  │                     │
└───────────────────┘  └─────────────────┘  └─────────────────────┘
```

## Key Features

1. **Slack Authentication** - Users authenticate via Slack identity, no GitHub accounts needed
2. **Multi-Project Hubs** - Each project gets its own hub channel (e.g., `#alpha-files`, `#beta-files`)
3. **Channel-Based Access Control** - Only hub channel members can access project files
4. **Exclusive Checkout** - Files are locked to one user at a time during editing
5. **Version Control** - Full version history via Git LFS with downloadable older versions
6. **Smart Reference Cards** - When shared elsewhere, cards show version at share time + current version
7. **Cross-Project Isolation** - Files and references are siloed per project for confidentiality

---

## File Hub + Reference Cards Architecture

### The Problem
Without structure, file cards get scattered across channels, threads, and DMs - making it hard to find files or know their current status. Additionally, different projects need isolated file spaces for confidentiality.

### The Solution

#### 1. Project File Hubs (one per project)
- **Any channel can become a hub** via `/files init`
- **One message per file** that updates in place as status changes
- **Thread activity log** showing checkout/checkin history
- **Access = channel membership** - Slack handles permissions
- Each project's files are completely isolated

#### 2. Reference Cards (shared within project scope)
When someone shares a file link in another channel:
- Shows the **version at time of sharing**
- **Auto-updates** to show if newer versions exist
- Links back to the project's hub
- **Only visible to users with hub access**

### How It Works

```
#alpha-files (Project Hub)                 #alpha-design (Team Channel)
┌─────────────────────────────┐            ┌─────────────────────────────┐
│ 📁 brand-logo.psd           │            │ @sarah: Check out the new   │
│ v5 | 12.3 MB | Available    │            │ logo I uploaded!            │
│ [Download & Check Out] [···]│            │                             │
└─────────────────────────────┘            │ ┌─────────────────────────┐ │
│ Thread:                     │            │ │ 📎 brand-logo.psd       │ │
├─ @mike checked in v5        │            │ │ Shared: v3 by @sarah    │ │
├─ @mike checked out          │            │ │ Current: v5 ⚠️ Updated  │ │
├─ @sarah checked in v4       │            │ │ [View in #alpha-files]  │ │
└─ ...                        │            │ └─────────────────────────┘ │
                                           └─────────────────────────────┘
```

### Reference Card States

| State | Display |
|-------|---------|
| Up to date | `v3` (no indicator) |
| Has newer version | `Shared: v3 → Current: v5 ⚠️ Updated` |
| File checked out | `Shared: v3 → 🔒 Checked out by @mike` |
| File deleted | `⚠️ This file has been removed` |

### User Flows

**Sharing a file:**
1. User types `/share brand-logo.psd` or uses a shortcut
2. Bot posts a Reference Card in the current channel
3. Card records the current version (e.g., v3) and channel/timestamp

**Reference card updates:**
1. When file is checked in with new version, bot finds all Reference Cards
2. Updates each card to show "Shared: v3 → Current: v5 ⚠️ Updated"
3. Users see at a glance that the version they were looking at is outdated

**Clicking "View in #files":**
1. Deep-links to the master file message in the hub
2. User can see full history, download, or check out

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Slack Integration** | Bolt.js | Official Slack app framework |
| **Block Kit** | slack-block-builder | Declarative UI construction |
| **Backend** | Node.js 20+ / TypeScript | Application runtime |
| **Database** | PostgreSQL 15+ | Metadata, locks, sessions |
| **ORM** | Prisma | Type-safe database access |
| **File Storage** | Git LFS + S3/MinIO | Versioned file storage |
| **Git Operations** | simple-git | Git command interface |

---

## Database Schema

```prisma
model User {
  id           String   @id @default(uuid())
  slackUserId  String   @unique
  slackTeamId  String
  displayName  String
  email        String?
  avatarUrl    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  uploadedVersions FileVersion[]
  locks            FileLock[]
  sharedReferences FileReference[]
  createdProjects  Project[]
}

// A project represents a file hub - one Slack channel = one project
model Project {
  id            String   @id @default(uuid())
  name          String                  // Display name
  slackTeamId   String
  hubChannelId  String   @unique        // The Slack channel that is this project's hub
  createdById   String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  createdBy User   @relation(fields: [createdById], references: [id])
  files     File[]

  @@index([slackTeamId])
}

model File {
  id             String   @id @default(uuid())
  projectId      String                  // Files belong to a project
  name           String
  path           String                  // Path within project (e.g., "/designs/logo.psd")
  lfsOid         String                  // Current version LFS OID
  sizeBytes      BigInt
  mimeType       String
  currentVersion Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  // Hub message tracking
  hubMessageTs   String?                 // Slack message timestamp (for updates)

  project    Project       @relation(fields: [projectId], references: [id])
  versions   FileVersion[]
  lock       FileLock?
  references FileReference[]

  @@unique([projectId, path])            // Unique path per project
  @@index([projectId])
}

model FileVersion {
  id            String   @id @default(uuid())
  fileId        String
  versionNumber Int
  lfsOid        String              // SHA256 hash of content
  sizeBytes     BigInt
  commitSha     String
  uploadedById  String
  message       String?             // Check-in message
  createdAt     DateTime @default(now())

  file       File @relation(fields: [fileId], references: [id])
  uploadedBy User @relation(fields: [uploadedById], references: [id])

  @@unique([fileId, versionNumber])
}

model FileLock {
  id         String    @id @default(uuid())
  fileId     String    @unique
  lockedById String
  lockedAt   DateTime  @default(now())
  expiresAt  DateTime?             // Optional auto-expiry
  lockReason String?

  file     File @relation(fields: [fileId], references: [id])
  lockedBy User @relation(fields: [lockedById], references: [id])
}

// Tracks reference cards shared in other channels/DMs
model FileReference {
  id              String   @id @default(uuid())
  fileId          String
  projectId       String              // Denormalized for access checks
  sharedById      String
  sharedAt        DateTime @default(now())
  sharedVersion   Int                 // Version at time of sharing

  // Slack message location
  channelId       String              // Channel/DM where shared
  messageTs       String              // Message timestamp (for updates)
  threadTs        String?             // Thread timestamp if in a thread

  file     File @relation(fields: [fileId], references: [id])
  sharedBy User @relation(fields: [sharedById], references: [id])

  @@unique([channelId, messageTs])
  @@index([fileId])
  @@index([projectId])
}
```

---

## Access Control

Access control is based entirely on **Slack channel membership**. No separate permissions system needed.

### How It Works

```typescript
class AccessService {
  constructor(private slack: WebClient) {}

  // Check if user can access a project's files
  async canAccessProject(userId: string, project: Project): Promise<boolean> {
    try {
      const result = await this.slack.conversations.members({
        channel: project.hubChannelId,
        limit: 1000
      });
      return result.members?.includes(userId) ?? false;
    } catch (error) {
      // Channel not found or bot not in channel
      return false;
    }
  }

  // Middleware for all file operations
  async assertAccess(userId: string, project: Project): Promise<void> {
    const hasAccess = await this.canAccessProject(userId, project);
    if (!hasAccess) {
      throw new AccessDeniedError(
        `You don't have access to this project. Join #${project.hubChannelId} to access its files.`
      );
    }
  }
}
```

### Access Rules

| Action | Requirement |
|--------|-------------|
| View file list | Member of project hub channel |
| Download file | Member of project hub channel |
| Check out file | Member of project hub channel |
| Check in file | Member of hub + holds the lock |
| Share file (create reference) | Member of project hub channel |
| View reference card | Member of project hub channel |
| Initialize new project | Any channel member (becomes hub) |

### Reference Card Visibility

When someone not in the project hub encounters a reference card:

```
┌──────────────────────────────────────────────────────────────┐
│  🔒 *Confidential File*                                      │
│  You don't have access to this project.                      │
│  Contact the file owner for access.                          │
└──────────────────────────────────────────────────────────────┘
```

### Sharing Restrictions

Files can only be shared via reference cards to channels where:
1. The sharer is a member of both the hub and target channel
2. OR the target channel has overlapping membership with the hub (configurable)

This prevents accidentally leaking file info to unauthorized channels.

---

## Project Structure

```
productinventor/
├── .env.example
├── package.json
├── tsconfig.json
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.ts                  # Entry point
│   ├── app.ts                    # Bolt app configuration
│   ├── config/
│   │   └── index.ts
│   ├── services/
│   │   ├── project.service.ts    # Project/hub management
│   │   ├── access.service.ts     # Channel-based access control
│   │   ├── file.service.ts       # File operations
│   │   ├── lock.service.ts       # Lock management
│   │   ├── git-lfs.service.ts    # Git LFS operations
│   │   ├── version.service.ts    # Version history
│   │   ├── user.service.ts       # User management
│   │   ├── hub.service.ts        # File Hub message management
│   │   └── reference.service.ts  # Reference card management
│   ├── listeners/
│   │   ├── commands/
│   │   │   ├── files.ts          # /files command (init, list, upload)
│   │   │   └── share.ts          # /share command (create reference)
│   │   ├── actions/
│   │   │   ├── checkout.ts       # Checkout handler
│   │   │   ├── checkin.ts        # Check-in handler
│   │   │   ├── download.ts       # Download handlers
│   │   │   └── reference.ts      # Reference card actions
│   │   └── views/
│   │       ├── checkin-modal.ts  # Check-in modal
│   │       └── upload-modal.ts   # Upload new file modal
│   ├── blocks/
│   │   ├── hub-file.blocks.ts    # Hub file card (master)
│   │   ├── reference.blocks.ts   # Reference card (shared)
│   │   ├── file-list.blocks.ts   # File browser list
│   │   ├── access-denied.blocks.ts
│   │   ├── checkin-modal.blocks.ts
│   │   └── version-history.blocks.ts
│   ├── utils/
│   │   ├── git.ts
│   │   ├── slack.ts              # Slack message helpers
│   │   └── errors.ts
│   └── types/
│       └── index.ts
└── lfs-storage/                  # Git LFS repository (per-project subdirs)
    ├── project-alpha/
    │   └── .git/lfs/objects/
    └── project-beta/
        └── .git/lfs/objects/
```

---

## Slack User Interface

### Hub File Card (in `#files` channel)

Each file has one persistent message in the hub that updates in place:

```
┌──────────────────────────────────────────────────────────────┐
│  📁 *brand-logo.psd*                                         │
│  /projects/design/brand-logo.psd                             │
│                                                              │
│  Version: *v5* | Size: 12.3 MB | Type: image/vnd.adobe.psd  │
│  Status: ✅ Available                                        │
│                                                              │
│  Last updated by @mike · Jan 10, 2026 at 2:30 PM            │
│  _"Final approved version with updated tagline"_             │
│                                                              │
│  [Download & Check Out]  [Download Only]  [History]  [···]   │
└──────────────────────────────────────────────────────────────┘
│ 4 replies
└── @mike checked in v5: "Final approved version..."
    @mike checked out
    @sarah checked in v4: "Added gradient background"
    @sarah checked out
```

When checked out:

```
┌──────────────────────────────────────────────────────────────┐
│  📁 *brand-logo.psd*                                         │
│  /projects/design/brand-logo.psd                             │
│                                                              │
│  Version: *v5* | Size: 12.3 MB | Type: image/vnd.adobe.psd  │
│  Status: 🔒 Checked out by @sarah                            │
│                                                              │
│  [Request Access]  [History]  [···]                          │
└──────────────────────────────────────────────────────────────┘
```

---

### Reference Card (shared in other channels/DMs/threads)

When a file is shared elsewhere via `/share filename`:

**Up to date:**
```
┌──────────────────────────────────────────────────────────────┐
│  📎 *brand-logo.psd*                                         │
│  Shared by @sarah · v5                                       │
│                                                              │
│  [View in #files]  [Download]                                │
└──────────────────────────────────────────────────────────────┘
```

**Newer version available:**
```
┌──────────────────────────────────────────────────────────────┐
│  📎 *brand-logo.psd*                            ⚠️ Updated   │
│  Shared: v3 by @sarah                                        │
│  Current: v5 (updated 2 hours ago)                           │
│                                                              │
│  [View in #files]  [Download v3]  [Get Latest (v5)]          │
└──────────────────────────────────────────────────────────────┘
```

**Currently checked out:**
```
┌──────────────────────────────────────────────────────────────┐
│  📎 *brand-logo.psd*                            🔒 Locked    │
│  Shared: v3 by @sarah                                        │
│  Currently checked out by @mike                              │
│                                                              │
│  [View in #files]  [Download v3]                             │
└──────────────────────────────────────────────────────────────┘
```

---

### File List View (via `/files` command)

```
┌──────────────────────────────────────────────────────────────┐
│  File Repository                                              │
│  12 files | Last updated: Jan 10, 2026 2:30 PM               │
├──────────────────────────────────────────────────────────────┤
│  ✅ *logo-final.psd*                                         │
│  /projects/design/logo-final.psd                             │
│  v3 | 45.2 MB | Available                                    │
│  [Download & Check Out]  [Download Only]  [···]              │
├──────────────────────────────────────────────────────────────┤
│  🔒 *brand-guidelines.pdf*                                   │
│  /projects/design/brand-guidelines.pdf                       │
│  v7 | 12.8 MB | Checked out by @sarah                        │
│  [Request Access]  [···]                                     │
├──────────────────────────────────────────────────────────────┤
│  🔒 *product-video.mp4*                                      │
│  /marketing/videos/product-video.mp4                         │
│  v2 | 234.5 MB | Checked out by you                          │
│  [Check In]  [Release Lock]  [···]                           │
└──────────────────────────────────────────────────────────────┘
```

### Check-In Modal

```
┌──────────────────────────────────────────────────────────────┐
│  Check In File                                    [X] Close  │
├──────────────────────────────────────────────────────────────┤
│  File: product-video.mp4                                     │
│  Current Version: v2                                         │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│                                                              │
│  Upload Updated File                                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  📎 Drop file here or click to upload                  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Version Notes (optional)                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Added new intro sequence and updated colors           │ │
│  │                                                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│                              [Cancel]  [Check In]            │
└──────────────────────────────────────────────────────────────┘
```

### Version History View

```
┌──────────────────────────────────────────────────────────────┐
│  Version History: logo-final.psd                             │
│  3 versions                                                  │
├──────────────────────────────────────────────────────────────┤
│  *v3* (current)                                    [Download]│
│  Uploaded by @mike                                           │
│  Jan 10, 2026 1:45 PM                                        │
│  _"Final approved version with updated tagline"_             │
├──────────────────────────────────────────────────────────────┤
│  *v2*                                              [Download]│
│  Uploaded by @sarah                                          │
│  Jan 8, 2026 3:20 PM                                         │
│  _"Added gradient background"_                               │
├──────────────────────────────────────────────────────────────┤
│  *v1*                                              [Download]│
│  Uploaded by @sarah                                          │
│  Jan 5, 2026 10:00 AM                                        │
│  _"Initial version"_                                         │
├──────────────────────────────────────────────────────────────┤
│  [← Back to Files]                                           │
└──────────────────────────────────────────────────────────────┘
```

---

## Core Service Logic

### Lock Service

```typescript
class LockService {
  async acquireLock(fileId: string, userId: string): Promise<FileLock> {
    const existingLock = await this.prisma.fileLock.findUnique({ where: { fileId } });

    if (existingLock && existingLock.lockedById !== userId) {
      throw new FileLockedError(`File is checked out by another user`);
    }

    return this.prisma.fileLock.upsert({
      where: { fileId },
      create: { fileId, lockedById: userId, expiresAt: addHours(new Date(), 24) },
      update: { lockedAt: new Date() }
    });
  }

  async releaseLock(fileId: string, userId: string): Promise<void> {
    const lock = await this.prisma.fileLock.findUnique({ where: { fileId } });
    if (lock?.lockedById !== userId) throw new UnauthorizedError();
    await this.prisma.fileLock.delete({ where: { fileId } });
  }
}
```

### File Service Checkout Flow

```typescript
class FileService {
  async checkoutFile(fileId: string, userId: string): Promise<{ file: File; downloadUrl: string }> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new FileNotFoundError();

    // Acquire lock (throws if locked by another)
    await this.lockService.acquireLock(fileId, userId);

    // Generate download URL
    const downloadUrl = await this.generateSignedUrl(file);
    return { file, downloadUrl };
  }

  async checkinFile(fileId: string, userId: string, uploadedFilePath: string, message?: string): Promise<FileVersion> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId }, include: { lock: true } });

    if (!file?.lock || file.lock.lockedById !== userId) {
      throw new UnauthorizedError('You must have the file checked out');
    }

    // Store in Git LFS
    const { oid, commitSha } = await this.gitLfs.storeFile(uploadedFilePath, file.name, userId, message);

    // Transaction: create version + update file + release lock
    const version = await this.prisma.$transaction(async (tx) => {
      const version = await tx.fileVersion.create({
        data: { fileId, versionNumber: file.currentVersion + 1, lfsOid: oid, commitSha, uploadedById: userId, message }
      });
      await tx.file.update({ where: { id: fileId }, data: { lfsOid: oid, currentVersion: file.currentVersion + 1 } });
      await tx.fileLock.delete({ where: { fileId } });
      return version;
    });

    // Update hub message and all reference cards
    await this.hubService.updateHubMessage(file);
    await this.referenceService.updateAllReferences(fileId);

    return version;
  }
}
```

### Hub Service

```typescript
class HubService {
  constructor(
    private prisma: PrismaClient,
    private slack: WebClient,
    private hubChannelId: string
  ) {}

  // Create or update the hub message for a file
  async updateHubMessage(file: File): Promise<void> {
    const fileWithDetails = await this.prisma.file.findUnique({
      where: { id: file.id },
      include: { lock: { include: { lockedBy: true } }, versions: { orderBy: { versionNumber: 'desc' }, take: 1 } }
    });

    const blocks = buildHubFileBlocks(fileWithDetails);

    if (file.hubMessageTs) {
      // Update existing message
      await this.slack.chat.update({
        channel: this.hubChannelId,
        ts: file.hubMessageTs,
        blocks
      });
    } else {
      // Create new message
      const result = await this.slack.chat.postMessage({
        channel: this.hubChannelId,
        blocks
      });

      // Store message reference
      await this.prisma.file.update({
        where: { id: file.id },
        data: { hubChannelId: this.hubChannelId, hubMessageTs: result.ts }
      });
    }
  }

  // Post activity to hub message thread
  async postActivity(file: File, message: string): Promise<void> {
    if (!file.hubMessageTs) return;

    await this.slack.chat.postMessage({
      channel: this.hubChannelId,
      thread_ts: file.hubMessageTs,
      text: message
    });
  }
}
```

### Reference Service

```typescript
class ReferenceService {
  constructor(
    private prisma: PrismaClient,
    private slack: WebClient
  ) {}

  // Share a file in a channel (creates reference card)
  async shareFile(fileId: string, userId: string, channelId: string, threadTs?: string): Promise<FileReference> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { lock: { include: { lockedBy: true } } }
    });

    if (!file) throw new FileNotFoundError();

    // Post reference card
    const blocks = buildReferenceBlocks(file, file.currentVersion, file.currentVersion);
    const result = await this.slack.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks
    });

    // Store reference
    return this.prisma.fileReference.create({
      data: {
        fileId,
        sharedById: userId,
        sharedVersion: file.currentVersion,
        channelId,
        messageTs: result.ts!,
        threadTs
      }
    });
  }

  // Update all reference cards for a file (called after checkin)
  async updateAllReferences(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { lock: { include: { lockedBy: true } } }
    });

    const references = await this.prisma.fileReference.findMany({
      where: { fileId }
    });

    for (const ref of references) {
      try {
        const blocks = buildReferenceBlocks(file, ref.sharedVersion, file.currentVersion);
        await this.slack.chat.update({
          channel: ref.channelId,
          ts: ref.messageTs,
          blocks
        });
      } catch (error) {
        // Message may have been deleted - remove reference
        if (error.data?.error === 'message_not_found') {
          await this.prisma.fileReference.delete({ where: { id: ref.id } });
        }
      }
    }
  }
}
```

---

## Slack Command & Action Handlers

### `/files` Command (Multi-purpose)

The `/files` command works differently based on context and arguments:

```typescript
app.command('/files', async ({ command, ack, respond, client }) => {
  await ack();

  const user = await userService.findOrCreateFromSlack({
    slackUserId: command.user_id,
    slackTeamId: command.team_id
  });

  const args = command.text.trim().split(' ');
  const subcommand = args[0]?.toLowerCase();

  // /files init - Initialize this channel as a project hub
  if (subcommand === 'init') {
    const projectName = args.slice(1).join(' ') || `Project ${command.channel_name}`;

    // Check if channel is already a hub
    const existingProject = await projectService.findByChannel(command.channel_id);
    if (existingProject) {
      await respond({ response_type: 'ephemeral', text: `This channel is already a file hub for "${existingProject.name}"` });
      return;
    }

    // Create new project
    const project = await projectService.create({
      name: projectName,
      hubChannelId: command.channel_id,
      slackTeamId: command.team_id,
      createdById: user.id
    });

    await respond({
      response_type: 'in_channel',
      text: `📁 *File Hub Initialized*\n\nThis channel is now the file hub for *${project.name}*.\n\nUse \`/files\` to browse files, \`/files upload\` to add files.`
    });
    return;
  }

  // For all other commands, find the project for this channel
  const project = await projectService.findByChannel(command.channel_id);

  if (!project) {
    // Not in a hub - show user's accessible projects
    const accessibleProjects = await projectService.findAccessibleByUser(command.user_id);

    if (accessibleProjects.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: `No file hubs found. Use \`/files init [project name]\` in a channel to create one.`
      });
    } else {
      await respond({
        response_type: 'ephemeral',
        blocks: buildProjectListBlocks(accessibleProjects)
      });
    }
    return;
  }

  // /files upload - Open upload modal
  if (subcommand === 'upload') {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: buildUploadModal(project)
    });
    return;
  }

  // /files (no args) - List files in this project
  const files = await fileService.listByProject(project.id);

  await respond({
    response_type: 'ephemeral',
    blocks: buildFileListBlocks(project, files, user.id)
  });
});
```

### Command Summary

| Command | Context | Action |
|---------|---------|--------|
| `/files init [name]` | Any channel | Make this channel a project file hub |
| `/files` | In a hub | List all files in this project |
| `/files` | Outside hub | Show list of accessible projects |
| `/files upload` | In a hub | Open upload modal for new file |
| `/share <filename>` | Any channel | Share a file as reference card |

### `/share` Command (Create Reference Card)

```typescript
app.command('/share', async ({ command, ack, respond, client }) => {
  await ack();

  const args = command.text.trim();
  if (!args) {
    await respond({ response_type: 'ephemeral', text: 'Usage: /share <filename> or /share <project>:<filename>' });
    return;
  }

  const user = await userService.findBySlackId(command.user_id);

  // Parse project:filename or just filename
  let projectName: string | undefined;
  let fileName: string;

  if (args.includes(':')) {
    [projectName, fileName] = args.split(':');
  } else {
    fileName = args;
  }

  // Find the file
  let file: File | null;

  if (projectName) {
    // Explicit project specified
    const project = await projectService.findByName(projectName);
    if (!project) {
      await respond({ response_type: 'ephemeral', text: `Project not found: ${projectName}` });
      return;
    }
    file = await fileService.findByNameInProject(fileName, project.id);
  } else {
    // Search across accessible projects
    file = await fileService.findByNameWithAccess(fileName, command.user_id);
  }

  if (!file) {
    await respond({ response_type: 'ephemeral', text: `File not found: ${fileName}` });
    return;
  }

  // Check user has access to this file's project
  const project = await projectService.findById(file.projectId);
  const hasAccess = await accessService.canAccessProject(command.user_id, project);

  if (!hasAccess) {
    await respond({ response_type: 'ephemeral', text: `You don't have access to this file's project.` });
    return;
  }

  // Create reference card in the current channel
  await referenceService.shareFile(
    file.id,
    user.id,
    command.channel_id,
    command.thread_ts
  );

  await respond({
    response_type: 'ephemeral',
    text: `Shared ${file.name} (v${file.currentVersion}) from ${project.name}`
  });
});
```

### Checkout Action

```typescript
app.action(/^file_checkout_(.+)$/, async ({ action, ack, body, client }) => {
  await ack();

  const fileId = action.action_id.replace('file_checkout_', '');
  const user = await userService.findBySlackId(body.user.id);

  try {
    const { file, downloadUrl } = await fileService.checkoutFile(fileId, user.id);

    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      blocks: buildCheckoutSuccessBlocks(file, downloadUrl)
    });
  } catch (error) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: `Checkout failed: ${error.message}`
    });
  }
});
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files` | List all files with lock status |
| `GET` | `/api/files/:id` | Get file details |
| `GET` | `/api/files/:id/versions` | Get version history |
| `GET` | `/api/files/:id/download` | Download current version |
| `GET` | `/api/files/:id/versions/:v/download` | Download specific version |
| `POST` | `/api/files/:id/checkout` | Check out (lock) file |
| `POST` | `/api/files/:id/checkin` | Check in with new version |
| `DELETE` | `/api/files/:id/checkout` | Release lock |

---

## Environment Configuration

```bash
# .env.example

# Slack App Credentials
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/file_checkout

# Git LFS Repository Path
LFS_REPO_PATH=/path/to/lfs-storage

# Optional: S3 for LFS object storage
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=file-checkout-lfs
AWS_REGION=us-east-1

# App Settings
NODE_ENV=development
PORT=3000
LOCK_EXPIRY_HOURS=24
```

---

## Implementation Phases

### Phase 1: Project Setup
- Initialize Node.js/TypeScript project with Bolt.js
- Create Slack App with required OAuth scopes (`commands`, `chat:write`, `chat:write.public`, `files:read`, `users:read`, `channels:read`, `groups:read`)
- Set up PostgreSQL database with Prisma
- Initialize Git LFS base repository structure

### Phase 2: Multi-Project Foundation
- Implement Project service (create, find by channel, list accessible)
- Implement Access service (channel membership checks)
- Implement User service (Slack identity mapping)
- Build `/files init` command to create project hubs

### Phase 3: Core File Services
- Implement Git LFS service (store, retrieve, version history) with per-project repos
- Implement Lock service (acquire, release, expiration)
- Implement File service (list by project, checkout, checkin)
- Build `/files` and `/files upload` commands

### Phase 4: Hub & Reference System
- Implement Hub service (create/update hub messages, post thread activity)
- Implement Reference service (share files, update reference cards)
- Build hub file card Block Kit UI
- Build reference card Block Kit UI with staleness indicators
- Add access-denied card for unauthorized viewers

### Phase 5: Slack Commands & Actions
- Build `/share` command with project-aware file lookup
- Implement checkout/download button actions with access checks
- Build check-in modal with file upload
- Implement version history view
- Add "View in #project-files" deep-linking

### Phase 6: File Transfer
- Implement secure file download with signed URLs
- Handle file upload from Slack
- Process and store in Git LFS (per-project)

### Phase 7: Polish & Deploy
- Error handling and edge cases
- Reference card cleanup (deleted messages)
- Access control edge cases (user removed from channel)
- Unit and integration tests
- Docker containerization
- Deployment and monitoring

---

## Security Considerations

1. **Slack Signature Verification** - Verify all incoming requests
2. **User Authorization** - Map Slack users to internal IDs, validate on every action
3. **Signed Download URLs** - Time-limited URLs for file downloads
4. **Input Sanitization** - Prevent path traversal in file names
5. **Rate Limiting** - Protect against abuse
6. **Audit Logging** - Track all file operations

---

## Potential Challenges

| Challenge | Mitigation |
|-----------|------------|
| Large file uploads (>1GB) | External upload flow with signed S3 URLs |
| Lock conflicts | Clear UI showing who has locks; admin override |
| Git LFS storage growth | Garbage collection; archive old versions |
| Concurrent operations | Database transactions with row locking |
| Slack API rate limits | Exponential backoff; batch operations |
