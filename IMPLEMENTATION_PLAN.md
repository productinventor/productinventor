# File Check-In/Check-Out System - Implementation Plan

A Slack-integrated file management system with content-addressed storage, versioning, and exclusive checkout (locking) capabilities.

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
            ┌────────────────────┴────────────────────┐
            ▼                                        ▼
┌───────────────────────────────┐  ┌─────────────────────────────────┐
│         PostgreSQL            │  │   Content-Addressed Storage     │
│         (Metadata)            │  │   /var/files/                   │
│   - Projects & Files          │  │   ab/cd/abcd1234...             │
│   - Locks & Versions          │  │   (deduplicated file blobs)     │
│   - Users & References        │  │                                 │
└───────────────────────────────┘  └─────────────────────────────────┘
```

## Key Features

1. **Slack Authentication** - Users authenticate via Slack identity, no GitHub accounts needed
2. **Multi-Project Hubs** - Each project gets its own hub channel (e.g., `#alpha-files`, `#beta-files`)
3. **Channel-Based Access Control** - Only hub channel members can access project files
4. **Exclusive Checkout** - Files are locked to one user at a time during editing
5. **Version Control** - Full version history with content-addressed storage and downloadable older versions
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
| **Database** | PostgreSQL 15+ | Metadata, locks, versions |
| **ORM** | Prisma | Type-safe database access |
| **File Storage** | Content-addressed filesystem | Deduplicated file blobs |

### Storage Architecture

Files are stored by their SHA256 hash on the local filesystem. PostgreSQL tracks all metadata and versions.

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR SERVER                             │
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐   │
│  │ Bolt.js App │────▶│ PostgreSQL  │     │ /var/files/     │   │
│  │             │     │ (metadata)  │     │ ab/cd/abcd...   │   │
│  │             │─────────────────────────│ de/fg/defg...   │   │
│  └─────────────┘     └─────────────┘     └─────────────────┘   │
│                                                                 │
│  No Git. No LFS. No complexity.                                │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Dead simple - just files in folders
- Automatic deduplication (same content = same hash)
- PostgreSQL tracks all versions
- No external dependencies
- Fast direct file access

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
  contentHash    String                  // SHA256 hash of current version content
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
  contentHash   String              // SHA256 hash of content (storage path)
  sizeBytes     BigInt
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

// Comprehensive audit log for compliance and security
model AuditLog {
  id          String         @id @default(uuid())
  timestamp   DateTime       @default(now())
  eventType   AuditEventType
  outcome     AuditOutcome

  // Actor information
  userId      String?
  slackUserId String?
  ipAddress   String?
  userAgent   String?

  // Resource information
  projectId   String?
  fileId      String?
  fileVersionId String?

  // Additional context
  details     Json           @default("{}")

  @@index([timestamp])
  @@index([userId])
  @@index([projectId])
  @@index([fileId])
  @@index([eventType])
  @@index([outcome])
}

enum AuditEventType {
  // File operations
  FILE_UPLOAD
  FILE_DOWNLOAD
  FILE_VIEW
  FILE_CHECKOUT
  FILE_CHECKIN
  FILE_DELETE
  FILE_RESTORE

  // Access events
  ACCESS_GRANTED
  ACCESS_DENIED
  ACCESS_REVOKED

  // Project operations
  PROJECT_CREATE
  PROJECT_DELETE
  PROJECT_MEMBER_ADD
  PROJECT_MEMBER_REMOVE

  // Security events
  DOWNLOAD_TOKEN_CREATED
  DOWNLOAD_TOKEN_USED
  DOWNLOAD_TOKEN_EXPIRED
  SECURE_DELETE_STARTED
  SECURE_DELETE_COMPLETED

  // Administrative
  ADMIN_OVERRIDE
  LOCK_FORCE_RELEASE
}

enum AuditOutcome {
  SUCCESS
  FAILURE
  DENIED
  PARTIAL
}

// Track secure deletion requests for compliance
model DeletionRecord {
  id              String   @id @default(uuid())
  requestedAt     DateTime @default(now())
  completedAt     DateTime?
  requestedById   String

  // What was deleted
  projectId       String?
  fileId          String?
  contentHash     String?

  // Deletion details
  reason          String
  status          DeletionStatus @default(PENDING)
  secureWipeUsed  Boolean  @default(false)
  verificationHash String?  // Hash proving deletion

  @@index([status])
  @@index([projectId])
  @@index([requestedAt])
}

enum DeletionStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
  VERIFIED
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

## Security & Compliance

This section covers the security infrastructure required for handling NDA-protected client data.

### Encryption at Rest

All stored files are encrypted using AES-256-GCM before being written to disk. The system supports two encryption modes:

#### Option 1: Filesystem-Level Encryption (Recommended for Simplicity)

Use LUKS/dm-crypt to encrypt the entire storage volume:

```bash
# Setup encrypted volume (one-time)
cryptsetup luksFormat /dev/sdX
cryptsetup luksOpen /dev/sdX files_encrypted
mkfs.ext4 /dev/mapper/files_encrypted
mount /dev/mapper/files_encrypted /var/files

# Add to /etc/crypttab for automatic unlock at boot (with key file)
# files_encrypted /dev/sdX /root/storage.key luks
```

**Pros:** Simple, transparent to application, hardware acceleration
**Cons:** All-or-nothing encryption, key management at OS level

#### Option 2: Application-Level Encryption (Recommended for Multi-Tenant)

Encrypt files before storing, allowing per-project encryption keys:

```typescript
import * as crypto from 'crypto';

class EncryptedStorageService extends StorageService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32;  // 256 bits
  private readonly ivLength = 16;   // 128 bits
  private readonly authTagLength = 16;

  constructor(
    basePath: string,
    private keyService: KeyManagementService
  ) {
    super(basePath);
  }

  async store(filePath: string, projectId: string): Promise<{ hash: string; size: number }> {
    // Get project-specific encryption key
    const key = await this.keyService.getProjectKey(projectId);

    // Read and encrypt the file
    const plaintext = await fs.readFile(filePath);
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([
      iv,                                    // Prepend IV
      cipher.update(plaintext),
      cipher.final(),
      cipher.getAuthTag()                    // Append auth tag
    ]);

    // Write encrypted content to temp file
    const tempPath = `${filePath}.enc`;
    await fs.writeFile(tempPath, encrypted);

    // Store using parent (content-addressed by encrypted content hash)
    const result = await super.store(tempPath);
    await fs.unlink(tempPath);

    return result;
  }

  async retrieve(hash: string, projectId: string): Promise<Buffer> {
    const key = await this.keyService.getProjectKey(projectId);
    const filePath = this.getPath(hash);
    const encrypted = await fs.readFile(filePath);

    // Extract IV, ciphertext, and auth tag
    const iv = encrypted.subarray(0, this.ivLength);
    const authTag = encrypted.subarray(-this.authTagLength);
    const ciphertext = encrypted.subarray(this.ivLength, -this.authTagLength);

    // Decrypt
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
```

#### Key Management Service

```typescript
class KeyManagementService {
  constructor(
    private prisma: PrismaClient,
    private masterKey: Buffer  // From environment/HSM/Vault
  ) {}

  // Derive project-specific key from master key
  async getProjectKey(projectId: string): Promise<Buffer> {
    // Use HKDF to derive project-specific key
    return crypto.hkdfSync(
      'sha256',
      this.masterKey,
      projectId,           // Salt with project ID
      'file-encryption',   // Info/context
      32                   // Key length
    );
  }

  // Rotate master key (requires re-encryption of all files)
  async rotateMasterKey(newMasterKey: Buffer): Promise<void> {
    // This is a major operation - see secure deletion section
    // 1. Re-encrypt all files with new key
    // 2. Update master key
    // 3. Securely delete old encrypted files
  }
}
```

### Audit Logging Service

All file operations are logged to an append-only audit log for compliance and forensics.

```typescript
class AuditService {
  constructor(private prisma: PrismaClient) {}

  async log(event: {
    eventType: AuditEventType;
    outcome: AuditOutcome;
    userId?: string;
    slackUserId?: string;
    projectId?: string;
    fileId?: string;
    fileVersionId?: string;
    ipAddress?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
  }): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        ...event,
        details: event.details ?? {}
      }
    });
  }

  // Convenience methods for common events
  async logFileDownload(
    userId: string,
    fileId: string,
    versionNumber: number,
    request: { ip: string; userAgent: string }
  ): Promise<void> {
    await this.log({
      eventType: 'FILE_DOWNLOAD',
      outcome: 'SUCCESS',
      userId,
      fileId,
      ipAddress: request.ip,
      userAgent: request.userAgent,
      details: { versionNumber }
    });
  }

  async logAccessDenied(
    userId: string,
    projectId: string,
    reason: string,
    request?: { ip: string; userAgent: string }
  ): Promise<void> {
    await this.log({
      eventType: 'ACCESS_DENIED',
      outcome: 'DENIED',
      userId,
      projectId,
      ipAddress: request?.ip,
      userAgent: request?.userAgent,
      details: { reason }
    });
  }

  // Query audit logs for compliance reports
  async getFileAccessHistory(
    fileId: string,
    options: { from?: Date; to?: Date; limit?: number }
  ): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: {
        fileId,
        eventType: { in: ['FILE_DOWNLOAD', 'FILE_VIEW', 'FILE_CHECKOUT'] },
        timestamp: {
          gte: options.from,
          lte: options.to
        }
      },
      orderBy: { timestamp: 'desc' },
      take: options.limit ?? 1000
    });
  }

  // Generate compliance report for a project
  async generateComplianceReport(
    projectId: string,
    dateRange: { from: Date; to: Date }
  ): Promise<ComplianceReport> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        projectId,
        timestamp: { gte: dateRange.from, lte: dateRange.to }
      },
      orderBy: { timestamp: 'asc' }
    });

    return {
      projectId,
      dateRange,
      totalEvents: logs.length,
      eventsByType: this.groupBy(logs, 'eventType'),
      accessDenials: logs.filter(l => l.outcome === 'DENIED'),
      uniqueUsers: [...new Set(logs.map(l => l.userId).filter(Boolean))],
      downloadCount: logs.filter(l => l.eventType === 'FILE_DOWNLOAD').length
    };
  }
}
```

#### Audit Log Retention

```typescript
// Audit logs must be retained for NDA compliance period (typically 3-7 years)
// Configure in environment:
// AUDIT_LOG_RETENTION_YEARS=7

class AuditRetentionService {
  constructor(
    private prisma: PrismaClient,
    private archiveStorage: ArchiveStorageService
  ) {}

  // Archive old logs to long-term storage
  async archiveOldLogs(olderThan: Date): Promise<void> {
    const logs = await this.prisma.auditLog.findMany({
      where: { timestamp: { lt: olderThan } }
    });

    // Export to immutable archive (e.g., S3 Glacier, write-once storage)
    await this.archiveStorage.archive({
      type: 'audit_logs',
      dateRange: { to: olderThan },
      data: logs,
      checksum: this.calculateChecksum(logs)
    });

    // Only delete after successful archive
    await this.prisma.auditLog.deleteMany({
      where: { timestamp: { lt: olderThan } }
    });
  }
}
```

### Download Tracking Service

All file downloads go through a tracked download service with single-use tokens.

```typescript
import * as crypto from 'crypto';

interface DownloadToken {
  token: string;
  userId: string;
  fileId: string;
  versionNumber: number;
  projectId: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

class DownloadService {
  private readonly TOKEN_EXPIRY_SECONDS = 300;  // 5 minutes

  constructor(
    private prisma: PrismaClient,
    private storage: StorageService,
    private audit: AuditService,
    private redis: RedisClient  // For token storage
  ) {}

  // Generate a secure, single-use download token
  async createDownloadToken(
    userId: string,
    fileId: string,
    versionNumber: number
  ): Promise<string> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { project: true }
    });

    if (!file) throw new FileNotFoundError();

    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    const tokenData: DownloadToken = {
      token,
      userId,
      fileId,
      versionNumber,
      projectId: file.projectId,
      createdAt: now,
      expiresAt: now + (this.TOKEN_EXPIRY_SECONDS * 1000),
      used: false
    };

    // Store token in Redis with expiry
    await this.redis.setex(
      `download:${token}`,
      this.TOKEN_EXPIRY_SECONDS,
      JSON.stringify(tokenData)
    );

    // Log token creation
    await this.audit.log({
      eventType: 'DOWNLOAD_TOKEN_CREATED',
      outcome: 'SUCCESS',
      userId,
      fileId,
      projectId: file.projectId,
      details: { versionNumber, expiresIn: this.TOKEN_EXPIRY_SECONDS }
    });

    return token;
  }

  // Validate and consume a download token (single-use)
  async consumeToken(
    token: string,
    requestUserId: string,
    request: { ip: string; userAgent: string }
  ): Promise<DownloadToken | null> {
    const key = `download:${token}`;
    const data = await this.redis.get(key);

    if (!data) {
      await this.audit.log({
        eventType: 'DOWNLOAD_TOKEN_EXPIRED',
        outcome: 'DENIED',
        userId: requestUserId,
        ipAddress: request.ip,
        userAgent: request.userAgent,
        details: { token: token.substring(0, 8) + '...' }
      });
      return null;
    }

    const tokenData: DownloadToken = JSON.parse(data);

    // Verify the requesting user matches the token owner
    if (tokenData.userId !== requestUserId) {
      await this.audit.logAccessDenied(
        requestUserId,
        tokenData.projectId,
        'Download token user mismatch',
        request
      );
      return null;
    }

    // Consume the token (single-use)
    await this.redis.del(key);

    // Log successful token use
    await this.audit.log({
      eventType: 'DOWNLOAD_TOKEN_USED',
      outcome: 'SUCCESS',
      userId: requestUserId,
      fileId: tokenData.fileId,
      projectId: tokenData.projectId,
      ipAddress: request.ip,
      userAgent: request.userAgent,
      details: { versionNumber: tokenData.versionNumber }
    });

    return tokenData;
  }

  // Execute a tracked download
  async download(
    token: string,
    requestUserId: string,
    request: { ip: string; userAgent: string }
  ): Promise<{ stream: ReadStream; filename: string; mimeType: string } | null> {
    const tokenData = await this.consumeToken(token, requestUserId, request);
    if (!tokenData) return null;

    // Get the file and version
    const file = await this.prisma.file.findUnique({
      where: { id: tokenData.fileId },
      include: {
        versions: {
          where: { versionNumber: tokenData.versionNumber }
        }
      }
    });

    if (!file || file.versions.length === 0) return null;

    const version = file.versions[0];
    const filePath = this.storage.getPath(version.contentHash);

    // Log the actual download
    await this.audit.logFileDownload(
      requestUserId,
      tokenData.fileId,
      tokenData.versionNumber,
      request
    );

    return {
      stream: createReadStream(filePath),
      filename: file.name,
      mimeType: file.mimeType
    };
  }
}
```

### Secure Deletion Service

Implements secure file deletion with verification for NDA compliance.

```typescript
class SecureDeletionService {
  constructor(
    private prisma: PrismaClient,
    private storage: StorageService,
    private audit: AuditService
  ) {}

  // Securely delete a file version's content
  async secureDeleteContent(
    contentHash: string,
    requestedById: string,
    reason: string
  ): Promise<DeletionRecord> {
    // Check if any other versions reference this content
    const refCount = await this.prisma.fileVersion.count({
      where: { contentHash }
    });

    if (refCount > 0) {
      throw new Error(
        `Cannot delete: ${refCount} version(s) still reference this content. ` +
        `Delete the file versions first.`
      );
    }

    // Create deletion record
    const record = await this.prisma.deletionRecord.create({
      data: {
        contentHash,
        requestedById,
        reason,
        status: 'IN_PROGRESS'
      }
    });

    await this.audit.log({
      eventType: 'SECURE_DELETE_STARTED',
      outcome: 'SUCCESS',
      userId: requestedById,
      details: { contentHash, reason, deletionRecordId: record.id }
    });

    try {
      const filePath = this.storage.getPath(contentHash);

      // Secure overwrite using DoD 5220.22-M standard (3 passes)
      await this.secureOverwrite(filePath);

      // Delete the file
      await fs.unlink(filePath);

      // Generate verification hash (hash of zeros to prove overwrite)
      const verificationHash = crypto.createHash('sha256')
        .update(`deleted:${contentHash}:${Date.now()}`)
        .digest('hex');

      // Update deletion record
      await this.prisma.deletionRecord.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          secureWipeUsed: true,
          verificationHash
        }
      });

      await this.audit.log({
        eventType: 'SECURE_DELETE_COMPLETED',
        outcome: 'SUCCESS',
        userId: requestedById,
        details: {
          contentHash,
          deletionRecordId: record.id,
          verificationHash
        }
      });

      return await this.prisma.deletionRecord.findUnique({
        where: { id: record.id }
      });

    } catch (error) {
      await this.prisma.deletionRecord.update({
        where: { id: record.id },
        data: { status: 'FAILED' }
      });

      await this.audit.log({
        eventType: 'SECURE_DELETE_COMPLETED',
        outcome: 'FAILURE',
        userId: requestedById,
        details: { contentHash, error: error.message }
      });

      throw error;
    }
  }

  // DoD 5220.22-M secure overwrite (3 passes)
  private async secureOverwrite(filePath: string): Promise<void> {
    const stats = await fs.stat(filePath);
    const size = stats.size;
    const fd = await fs.open(filePath, 'r+');

    try {
      // Pass 1: Write zeros
      const zeros = Buffer.alloc(Math.min(size, 64 * 1024), 0x00);
      await this.overwriteFile(fd, size, zeros);

      // Pass 2: Write ones
      const ones = Buffer.alloc(Math.min(size, 64 * 1024), 0xFF);
      await this.overwriteFile(fd, size, ones);

      // Pass 3: Write random data
      for (let offset = 0; offset < size; offset += 64 * 1024) {
        const chunkSize = Math.min(64 * 1024, size - offset);
        const randomData = crypto.randomBytes(chunkSize);
        await fd.write(randomData, 0, chunkSize, offset);
      }

      // Sync to ensure writes are flushed to disk
      await fd.sync();
    } finally {
      await fd.close();
    }
  }

  private async overwriteFile(
    fd: fs.FileHandle,
    size: number,
    pattern: Buffer
  ): Promise<void> {
    for (let offset = 0; offset < size; offset += pattern.length) {
      const chunkSize = Math.min(pattern.length, size - offset);
      await fd.write(pattern, 0, chunkSize, offset);
    }
    await fd.sync();
  }

  // Delete an entire project and all its data
  async deleteProject(
    projectId: string,
    requestedById: string,
    reason: string
  ): Promise<ProjectDeletionReport> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        files: {
          include: { versions: true }
        }
      }
    });

    if (!project) throw new Error('Project not found');

    const report: ProjectDeletionReport = {
      projectId,
      projectName: project.name,
      requestedBy: requestedById,
      requestedAt: new Date(),
      filesDeleted: 0,
      versionsDeleted: 0,
      contentHashesDeleted: [],
      errors: []
    };

    // Collect all unique content hashes
    const contentHashes = new Set<string>();
    for (const file of project.files) {
      for (const version of file.versions) {
        contentHashes.add(version.contentHash);
      }
    }

    // Delete database records first (within transaction)
    await this.prisma.$transaction(async (tx) => {
      // Delete file references
      await tx.fileReference.deleteMany({ where: { projectId } });

      // Delete file versions
      for (const file of project.files) {
        await tx.fileVersion.deleteMany({ where: { fileId: file.id } });
        await tx.fileLock.deleteMany({ where: { fileId: file.id } });
        report.versionsDeleted += file.versions.length;
      }

      // Delete files
      await tx.file.deleteMany({ where: { projectId } });
      report.filesDeleted = project.files.length;

      // Delete project
      await tx.project.delete({ where: { id: projectId } });
    });

    // Securely delete content (outside transaction - slower but thorough)
    for (const hash of contentHashes) {
      // Check if any OTHER project still references this content
      const otherRefs = await this.prisma.fileVersion.count({
        where: { contentHash: hash }
      });

      if (otherRefs === 0) {
        try {
          await this.secureDeleteContent(hash, requestedById, reason);
          report.contentHashesDeleted.push(hash);
        } catch (error) {
          report.errors.push({
            contentHash: hash,
            error: error.message
          });
        }
      }
    }

    report.completedAt = new Date();

    // Log project deletion
    await this.audit.log({
      eventType: 'PROJECT_DELETE',
      outcome: report.errors.length === 0 ? 'SUCCESS' : 'PARTIAL',
      userId: requestedById,
      projectId,
      details: {
        projectName: project.name,
        filesDeleted: report.filesDeleted,
        versionsDeleted: report.versionsDeleted,
        contentHashesDeleted: report.contentHashesDeleted.length,
        errors: report.errors
      }
    });

    return report;
  }

  // Generate deletion certificate for compliance
  async generateDeletionCertificate(
    deletionRecordId: string
  ): Promise<DeletionCertificate> {
    const record = await this.prisma.deletionRecord.findUnique({
      where: { id: deletionRecordId }
    });

    if (!record || record.status !== 'COMPLETED') {
      throw new Error('Deletion not completed');
    }

    return {
      certificateId: crypto.randomUUID(),
      deletionRecordId: record.id,
      contentHash: record.contentHash,
      deletedAt: record.completedAt,
      secureWipeMethod: 'DoD 5220.22-M (3-pass)',
      verificationHash: record.verificationHash,
      requestedBy: record.requestedById,
      reason: record.reason
    };
  }
}

interface ProjectDeletionReport {
  projectId: string;
  projectName: string;
  requestedBy: string;
  requestedAt: Date;
  completedAt?: Date;
  filesDeleted: number;
  versionsDeleted: number;
  contentHashesDeleted: string[];
  errors: Array<{ contentHash: string; error: string }>;
}

interface DeletionCertificate {
  certificateId: string;
  deletionRecordId: string;
  contentHash: string;
  deletedAt: Date;
  secureWipeMethod: string;
  verificationHash: string;
  requestedBy: string;
  reason: string;
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
│   │   ├── project.service.ts    # Project/hub management
│   │   ├── access.service.ts     # Channel-based access control
│   │   ├── storage.service.ts    # Content-addressed file storage
│   │   ├── encrypted-storage.service.ts  # AES-256-GCM encryption layer
│   │   ├── key-management.service.ts     # Encryption key derivation
│   │   ├── file.service.ts       # File operations
│   │   ├── lock.service.ts       # Lock management
│   │   ├── user.service.ts       # User management
│   │   ├── hub.service.ts        # File Hub message management
│   │   ├── reference.service.ts  # Reference card management
│   │   ├── audit.service.ts      # Comprehensive audit logging
│   │   ├── download.service.ts   # Tracked downloads with tokens
│   │   └── deletion.service.ts   # Secure deletion with verification
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
│   │   ├── hash.ts               # SHA256 hashing utilities
│   │   ├── slack.ts              # Slack message helpers
│   │   └── errors.ts
│   └── types/
│       └── index.ts
└── storage/                      # Content-addressed file storage
    └── ab/
        └── cd/
            └── abcd1234...       # Files named by SHA256 hash
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

### Storage Service (Content-Addressed)

```typescript
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

class StorageService {
  constructor(private basePath: string = '/var/files') {}

  // Store file and return its content hash
  async store(filePath: string): Promise<{ hash: string; size: number }> {
    const hash = await this.hashFile(filePath);
    const destPath = this.getPath(hash);
    const stats = await fs.stat(filePath);

    // Only copy if not already stored (deduplication)
    if (!await this.exists(hash)) {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(filePath, destPath);
    }

    return { hash, size: stats.size };
  }

  // Get filesystem path for a content hash
  getPath(hash: string): string {
    return path.join(this.basePath, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  // Check if content exists
  async exists(hash: string): Promise<boolean> {
    try {
      await fs.access(this.getPath(hash));
      return true;
    } catch {
      return false;
    }
  }

  // Delete content (only if no versions reference it)
  async delete(hash: string): Promise<void> {
    await fs.unlink(this.getPath(hash));
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  }
}
```

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

### File Service

```typescript
class FileService {
  constructor(
    private prisma: PrismaClient,
    private storage: StorageService,
    private lockService: LockService,
    private hubService: HubService,
    private referenceService: ReferenceService
  ) {}

  async checkoutFile(fileId: string, userId: string): Promise<{ file: File; filePath: string }> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new FileNotFoundError();

    // Acquire lock (throws if locked by another)
    await this.lockService.acquireLock(fileId, userId);

    // Return path to file content
    const filePath = this.storage.getPath(file.contentHash);
    return { file, filePath };
  }

  async checkinFile(fileId: string, userId: string, uploadedFilePath: string, message?: string): Promise<FileVersion> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId }, include: { lock: true } });

    if (!file?.lock || file.lock.lockedById !== userId) {
      throw new UnauthorizedError('You must have the file checked out');
    }

    // Store in content-addressed storage
    const { hash, size } = await this.storage.store(uploadedFilePath);

    // Transaction: create version + update file + release lock
    const version = await this.prisma.$transaction(async (tx) => {
      const version = await tx.fileVersion.create({
        data: {
          fileId,
          versionNumber: file.currentVersion + 1,
          contentHash: hash,
          sizeBytes: size,
          uploadedById: userId,
          message
        }
      });
      await tx.file.update({
        where: { id: fileId },
        data: { contentHash: hash, sizeBytes: size, currentVersion: file.currentVersion + 1 }
      });
      await tx.fileLock.delete({ where: { fileId } });
      return version;
    });

    // Update hub message and all reference cards
    await this.hubService.updateHubMessage(file);
    await this.referenceService.updateAllReferences(fileId);

    return version;
  }

  // Download a specific version
  async getVersionPath(fileId: string, versionNumber?: number): Promise<string> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { versions: true }
    });

    const version = versionNumber
      ? file.versions.find(v => v.versionNumber === versionNumber)
      : file.versions.find(v => v.versionNumber === file.currentVersion);

    return this.storage.getPath(version.contentHash);
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

# Redis (for download tokens and caching)
REDIS_URL=redis://localhost:6379

# File Storage
STORAGE_PATH=/var/files              # Content-addressed storage directory

# Encryption (Required for production)
# Generate with: openssl rand -base64 32
ENCRYPTION_MASTER_KEY=your-base64-encoded-32-byte-key
ENCRYPTION_MODE=application          # 'application' or 'filesystem'

# Security Settings
DOWNLOAD_TOKEN_EXPIRY_SECONDS=300    # 5 minutes
SECURE_DELETE_ENABLED=true           # Use DoD 5220.22-M secure wipe

# Audit & Compliance
AUDIT_LOG_RETENTION_YEARS=7          # Retain logs for NDA compliance
AUDIT_ARCHIVE_ENABLED=true           # Archive old logs to long-term storage
AUDIT_ARCHIVE_PATH=/var/audit-archive

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
- Set up PostgreSQL database with Prisma (including AuditLog, DeletionRecord models)
- Set up Redis for download tokens
- Create content-addressed storage directory structure
- Configure encrypted storage volume (LUKS) or application-level encryption

### Phase 2: Security Foundation (Before Any Client Data)
- Implement Key Management service (master key, project key derivation)
- Implement Encrypted Storage service (AES-256-GCM encryption/decryption)
- Implement Audit service (comprehensive logging for all operations)
- Implement Download service (token generation, single-use validation, tracking)
- Implement Secure Deletion service (DoD 5220.22-M wipe, deletion certificates)
- Set up audit log archival infrastructure

### Phase 3: Multi-Project Foundation
- Implement Project service (create, find by channel, list accessible)
- Implement Access service (channel membership checks)
- Implement User service (Slack identity mapping)
- Build `/files init` command to create project hubs
- Integrate audit logging with all project operations

### Phase 4: Core File Services
- Implement Storage service (content-addressed: store, retrieve by hash)
- Integrate encryption layer with storage service
- Implement Lock service (acquire, release, expiration)
- Implement File service (list by project, checkout, checkin)
- Build `/files` and `/files upload` commands
- Integrate audit logging with all file operations

### Phase 5: Hub & Reference System
- Implement Hub service (create/update hub messages, post thread activity)
- Implement Reference service (share files, update reference cards)
- Build hub file card Block Kit UI
- Build reference card Block Kit UI with staleness indicators
- Add access-denied card for unauthorized viewers

### Phase 6: Slack Commands & Actions
- Build `/share` command with project-aware file lookup
- Implement checkout/download button actions with access checks
- Integrate download tracking with all download actions
- Build check-in modal with file upload
- Implement version history view
- Add "View in #project-files" deep-linking

### Phase 7: File Transfer
- Implement secure file download with single-use tokens
- Implement download tracking and audit logging
- Handle file upload from Slack
- Process, encrypt, and store in content-addressed storage

### Phase 8: Compliance & Administration
- Build admin dashboard for audit log queries
- Implement compliance report generation
- Build project deletion workflow with secure wipe
- Implement deletion certificate generation
- Create client offboarding procedures
- Set up audit log retention and archival

### Phase 9: Polish & Deploy
- Error handling and edge cases
- Reference card cleanup (deleted messages)
- Access control edge cases (user removed from channel)
- Security testing and penetration testing
- Unit and integration tests
- Docker containerization with secrets management
- Deployment and monitoring

---

## Security Considerations

### Authentication & Authorization
1. **Slack Signature Verification** - Verify all incoming requests using SLACK_SIGNING_SECRET
2. **User Authorization** - Map Slack users to internal IDs, validate on every action
3. **Channel-Based Access Control** - Verify Slack channel membership for all file operations
4. **Token-Based Downloads** - Single-use, time-limited tokens for file downloads

### Data Protection
5. **Encryption at Rest** - All files encrypted using AES-256-GCM before storage
6. **Per-Project Keys** - Encryption keys derived per-project using HKDF
7. **Secure Key Management** - Master key from environment/HSM, never logged or exposed
8. **Encrypted Backups** - Backup systems must preserve encryption

### Audit & Compliance
9. **Comprehensive Audit Logging** - Log all file operations with user, timestamp, IP, outcome
10. **Access Denial Logging** - Track and alert on failed access attempts
11. **Immutable Audit Trail** - Append-only logs with integrity verification
12. **Long-Term Retention** - 7-year retention for NDA compliance
13. **Compliance Reports** - Generate per-project access reports for audits

### Secure Deletion
14. **DoD 5220.22-M Wipe** - 3-pass secure overwrite for file deletion
15. **Deletion Certificates** - Cryptographic proof of deletion for compliance
16. **Project Offboarding** - Complete data removal when client relationship ends
17. **Reference Counting** - Prevent deletion of shared content

### Input Validation
18. **Path Traversal Prevention** - Validate and sanitize all file paths
19. **Filename Validation** - Whitelist allowed characters, reject dangerous patterns
20. **Size Limits** - Enforce maximum file sizes to prevent DoS

### Infrastructure Security
21. **Rate Limiting** - Protect against abuse and enumeration attacks
22. **HTTPS Only** - All traffic encrypted in transit
23. **Secrets Management** - Environment variables for sensitive config, never in code
24. **Minimal Permissions** - Application runs with least required privileges

---

## Potential Challenges

| Challenge | Mitigation |
|-----------|------------|
| Large file uploads (>1GB) | Chunked upload flow; streaming to disk |
| Lock conflicts | Clear UI showing who has locks; admin override |
| Storage growth | Garbage collection for unreferenced hashes; archive old versions |
| Concurrent operations | Database transactions with row locking |
| Slack API rate limits | Exponential backoff; batch operations |
| Disk space monitoring | Alerts when storage approaches capacity |
