# File Check-In/Check-Out System - Implementation Plan

A Slack-integrated file management system with Git LFS versioning and exclusive checkout (locking) capabilities.

## Core Concept

Users interact with files entirely through Slack. A **central File Hub channel** (`#files`) serves as the single source of truth, with each file having one persistent, updating message. When files are shared elsewhere, **Reference Cards** appear that stay aware of version changes.

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
2. **Exclusive Checkout** - Files are locked to one user at a time during editing
3. **Version Control** - Full version history via Git LFS with downloadable older versions
4. **File Hub Channel** - Central `#files` channel with one persistent message per file
5. **Smart Reference Cards** - When shared elsewhere, cards show version at share time + current version

---

## File Hub + Reference Cards Architecture

### The Problem
Without structure, file cards get scattered across channels, threads, and DMs - making it hard to find files or know their current status.

### The Solution

#### 1. Central File Hub (`#files` channel)
- **One message per file** that updates in place as status changes
- **Thread activity log** showing checkout/checkin history
- **Pinnable** for quick access to important files
- Single source of truth for file status

#### 2. Reference Cards (shared elsewhere)
When someone shares a file link in another channel or DM:
- Shows the **version at time of sharing**
- **Auto-updates** to show if newer versions exist
- Links back to the hub for full interaction

### How It Works

```
#files (File Hub)                          #design-team
┌─────────────────────────────┐            ┌─────────────────────────────┐
│ 📁 brand-logo.psd           │            │ @sarah: Check out the new   │
│ v5 | 12.3 MB | Available    │            │ logo I uploaded!            │
│ [Download & Check Out] [···]│            │                             │
└─────────────────────────────┘            │ ┌─────────────────────────┐ │
│ Thread:                     │            │ │ 📎 brand-logo.psd       │ │
├─ @mike checked in v5        │            │ │ Shared: v3 by @sarah    │ │
├─ @mike checked out          │            │ │ Current: v5 ⚠️ Updated  │ │
├─ @sarah checked in v4       │            │ │ [View in #files] [Get v5]│ │
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
}

model File {
  id             String   @id @default(uuid())
  name           String
  path           String   @unique
  lfsOid         String              // Current version LFS OID
  sizeBytes      BigInt
  mimeType       String
  currentVersion Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  // Hub message tracking
  hubChannelId   String?             // #files channel ID
  hubMessageTs   String?             // Slack message timestamp (for updates)

  versions   FileVersion[]
  lock       FileLock?
  references FileReference[]
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
}
```

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
│   │   ├── file.service.ts       # File operations
│   │   ├── lock.service.ts       # Lock management
│   │   ├── git-lfs.service.ts    # Git LFS operations
│   │   ├── version.service.ts    # Version history
│   │   ├── user.service.ts       # User management
│   │   ├── hub.service.ts        # File Hub message management
│   │   └── reference.service.ts  # Reference card management
│   ├── listeners/
│   │   ├── commands/
│   │   │   ├── files.ts          # /files command
│   │   │   └── share.ts          # /share command (create reference)
│   │   ├── actions/
│   │   │   ├── checkout.ts       # Checkout handler
│   │   │   ├── checkin.ts        # Check-in handler
│   │   │   ├── download.ts       # Download handlers
│   │   │   └── reference.ts      # Reference card actions
│   │   └── views/
│   │       └── checkin-modal.ts  # Check-in modal
│   ├── blocks/
│   │   ├── hub-file.blocks.ts    # Hub file card (master)
│   │   ├── reference.blocks.ts   # Reference card (shared)
│   │   ├── file-list.blocks.ts   # File browser list
│   │   ├── checkin-modal.blocks.ts
│   │   └── version-history.blocks.ts
│   ├── utils/
│   │   ├── git.ts
│   │   ├── slack.ts              # Slack message helpers
│   │   └── errors.ts
│   └── types/
│       └── index.ts
└── lfs-storage/                  # Git LFS repository
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

### `/files` Command

```typescript
app.command('/files', async ({ command, ack, respond }) => {
  await ack();

  const user = await userService.findOrCreateFromSlack({
    slackUserId: command.user_id,
    slackTeamId: command.team_id
  });

  const files = await fileService.listFiles();

  await respond({
    response_type: 'ephemeral',
    blocks: buildFileListBlocks(files, user.id)
  });
});
```

### `/share` Command (Create Reference Card)

```typescript
app.command('/share', async ({ command, ack, respond, client }) => {
  await ack();

  const fileName = command.text.trim();
  if (!fileName) {
    await respond({ response_type: 'ephemeral', text: 'Usage: /share <filename>' });
    return;
  }

  const user = await userService.findBySlackId(command.user_id);
  const file = await fileService.findByName(fileName);

  if (!file) {
    await respond({ response_type: 'ephemeral', text: `File not found: ${fileName}` });
    return;
  }

  // Create reference card in the current channel
  await referenceService.shareFile(
    file.id,
    user.id,
    command.channel_id,
    command.thread_ts  // If in a thread, post to thread
  );

  // Ephemeral confirmation
  await respond({
    response_type: 'ephemeral',
    text: `Shared ${file.name} (v${file.currentVersion}) in this channel`
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
- Create Slack App with required OAuth scopes (`commands`, `chat:write`, `chat:write.public`, `files:read`, `users:read`)
- Set up PostgreSQL database with Prisma
- Initialize Git LFS repository
- Create `#files` hub channel

### Phase 2: Core Services
- Implement Git LFS service (store, retrieve, version history)
- Implement Lock service (acquire, release, expiration)
- Implement File service (list, checkout, checkin)
- Implement User service (Slack identity mapping)

### Phase 3: Hub & Reference System
- Implement Hub service (create/update hub messages, post thread activity)
- Implement Reference service (share files, update reference cards)
- Build hub file card Block Kit UI
- Build reference card Block Kit UI with staleness indicators

### Phase 4: Slack Commands & Actions
- Build `/files` command with file list UI
- Build `/share` command for creating reference cards
- Implement checkout/download button actions
- Build check-in modal with file upload
- Implement version history view
- Add "View in #files" deep-linking

### Phase 5: File Transfer
- Implement secure file download with signed URLs
- Handle file upload from Slack
- Process and store in Git LFS

### Phase 6: Polish & Deploy
- Error handling and edge cases
- Reference card cleanup (deleted messages)
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
