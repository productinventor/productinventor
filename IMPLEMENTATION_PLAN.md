# File Check-In/Check-Out System - Implementation Plan

A Slack-integrated file management system with Git LFS versioning and exclusive checkout (locking) capabilities.

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
4. **Slack Card UI** - Rich Block Kit interface for browsing, downloading, and checking in files

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

  versions FileVersion[]
  lock     FileLock?
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
│   │   └── user.service.ts       # User management
│   ├── listeners/
│   │   ├── commands/
│   │   │   └── files.ts          # /files command
│   │   ├── actions/
│   │   │   ├── checkout.ts       # Checkout handler
│   │   │   ├── checkin.ts        # Check-in handler
│   │   │   └── download.ts       # Download handlers
│   │   └── views/
│   │       └── checkin-modal.ts  # Check-in modal
│   ├── blocks/
│   │   ├── file-list.blocks.ts
│   │   ├── checkin-modal.blocks.ts
│   │   └── version-history.blocks.ts
│   ├── utils/
│   │   ├── git.ts
│   │   └── errors.ts
│   └── types/
│       └── index.ts
└── lfs-storage/                  # Git LFS repository
    └── .git/lfs/objects/
```

---

## Slack User Interface

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
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.fileVersion.create({
        data: { fileId, versionNumber: file.currentVersion + 1, lfsOid: oid, commitSha, uploadedById: userId, message }
      });
      await tx.file.update({ where: { id: fileId }, data: { lfsOid: oid, currentVersion: file.currentVersion + 1 } });
      await tx.fileLock.delete({ where: { fileId } });
      return version;
    });
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
- Create Slack App with required OAuth scopes
- Set up PostgreSQL database with Prisma
- Initialize Git LFS repository

### Phase 2: Core Services
- Implement Git LFS service (store, retrieve, version history)
- Implement Lock service (acquire, release, expiration)
- Implement File service (list, checkout, checkin)
- Implement User service (Slack identity mapping)

### Phase 3: Slack Integration
- Build `/files` command with file list UI
- Implement checkout/download button actions
- Build check-in modal with file upload
- Implement version history view

### Phase 4: File Transfer
- Implement secure file download with signed URLs
- Handle file upload from Slack
- Process and store in Git LFS

### Phase 5: Polish & Deploy
- Error handling and edge cases
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
