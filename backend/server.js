import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { put, del, list } from '@vercel/blob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// 25 MB file limit (in bytes)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// 24-Hour Expiry Duration (in milliseconds)
const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000;

// Local fallback uploads directory (used when BLOB_READ_WRITE_TOKEN is not set)
const localUploadsDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'quickshare-uploads')
  : path.join(__dirname, 'uploads');

if (!fs.existsSync(localUploadsDir)) {
  try {
    fs.mkdirSync(localUploadsDir, { recursive: true });
  } catch (e) {}
}

// In-memory cache for ultra-fast lookup
const transferCache = new Map();

// Helper: check if Vercel Blob is configured
function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Generate unique, readable transfer ID (e.g., qs-4a8f9c2e)
function generateTransferId() {
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `qs-${randomHex}`;
}

// =========================================================================
// STORAGE LAYER: Vercel Blob (Production) with Local Disk Fallback (Dev)
// =========================================================================

// 1. Save file and metadata
async function saveTransfer({ transferId, originalname, mimetype, buffer, size }) {
  const now = Date.now();
  const uploadedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + EXPIRY_DURATION_MS).toISOString();
  const safeOriginal = originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uniqueFilename = `${Date.now()}-${safeOriginal}`;

  if (isBlobConfigured()) {
    // A) VERCEL BLOB STORAGE (Persistent across all serverless instances)
    const blobPath = `quickshare/files/${transferId}/${safeOriginal}`;
    const blobResult = await put(blobPath, buffer, {
      access: 'public',
      contentType: mimetype || 'application/octet-stream',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    const fileData = {
      transferId,
      filename: uniqueFilename,
      originalname,
      size,
      mimetype: mimetype || 'application/octet-stream',
      uploadedAt,
      expiresAt,
      storageType: 'blob',
      blobUrl: blobResult.url,
      blobDownloadUrl: blobResult.downloadUrl || blobResult.url,
      downloadUrl: `/api/transfer/${encodeURIComponent(transferId)}/download`,
      transferDownloadUrl: `/api/transfer/${encodeURIComponent(transferId)}/download`,
      viewUrl: blobResult.url
    };

    // Save JSON metadata into Vercel Blob
    const metaPath = `quickshare/meta/${transferId}.json`;
    await put(metaPath, JSON.stringify(fileData, null, 2), {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    transferCache.set(transferId, fileData);
    return fileData;
  } else {
    // B) LOCAL DISK FALLBACK (For local development or when Blob token is omitted)
    const filePath = path.join(localUploadsDir, uniqueFilename);
    fs.writeFileSync(filePath, buffer);

    const fileData = {
      transferId,
      filename: uniqueFilename,
      originalname,
      size,
      mimetype: mimetype || 'application/octet-stream',
      uploadedAt,
      expiresAt,
      storageType: 'local',
      downloadUrl: `/api/files/${encodeURIComponent(uniqueFilename)}/download`,
      transferDownloadUrl: `/api/transfer/${encodeURIComponent(transferId)}/download`,
      viewUrl: `/api/files/${encodeURIComponent(uniqueFilename)}/view`
    };

    const metaFilePath = path.join(localUploadsDir, `${transferId}.json`);
    try {
      fs.writeFileSync(metaFilePath, JSON.stringify(fileData, null, 2), 'utf8');
    } catch (e) {}

    transferCache.set(transferId, fileData);
    return fileData;
  }
}

// 2. Retrieve transfer metadata by transferId
async function getTransfer(transferId) {
  if (!transferId) return null;

  // Check in-memory cache first
  const cached = transferCache.get(transferId);
  if (cached) {
    if (Date.now() > new Date(cached.expiresAt).getTime()) {
      transferCache.delete(transferId);
      return { expired: true };
    }
    return cached;
  }

  if (isBlobConfigured()) {
    // Query Vercel Blob metadata
    try {
      const { blobs } = await list({
        prefix: `quickshare/meta/${transferId}.json`,
        token: process.env.BLOB_READ_WRITE_TOKEN
      });

      if (blobs.length > 0) {
        const res = await fetch(blobs[0].url);
        if (res.ok) {
          const meta = await res.json();
          if (Date.now() > new Date(meta.expiresAt).getTime()) {
            // Cleanup expired
            del([blobs[0].url, meta.blobUrl], { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {});
            return { expired: true };
          }
          transferCache.set(transferId, meta);
          return meta;
        }
      }
    } catch (err) {
      console.error('Error fetching transfer from Vercel Blob:', err);
    }
    return null;
  } else {
    // Query local disk
    const safeId = String(transferId).replace(/[^a-zA-Z0-9_-]/g, '');
    const metaPath = path.join(localUploadsDir, `${safeId}.json`);
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (Date.now() > new Date(meta.expiresAt).getTime()) {
          try { fs.unlinkSync(metaPath); } catch (e) {}
          const fPath = path.join(localUploadsDir, meta.filename);
          if (fs.existsSync(fPath)) { try { fs.unlinkSync(fPath); } catch (e) {} }
          return { expired: true };
        }
        transferCache.set(transferId, meta);
        return meta;
      } catch (e) {}
    }
    return null;
  }
}

// 3. List all active transfers
async function getAllTransfers() {
  const now = Date.now();
  const results = [];

  if (isBlobConfigured()) {
    try {
      const { blobs } = await list({
        prefix: 'quickshare/meta/',
        token: process.env.BLOB_READ_WRITE_TOKEN
      });

      const expiredBlobUrls = [];
      for (const b of blobs) {
        try {
          const res = await fetch(b.url);
          if (res.ok) {
            const meta = await res.json();
            if (now > new Date(meta.expiresAt).getTime()) {
              expiredBlobUrls.push(b.url);
              if (meta.blobUrl) expiredBlobUrls.push(meta.blobUrl);
            } else {
              results.push(meta);
              transferCache.set(meta.transferId, meta);
            }
          }
        } catch (e) {}
      }

      if (expiredBlobUrls.length > 0) {
        del(expiredBlobUrls, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {});
      }
    } catch (err) {
      console.error('Error listing Vercel Blobs:', err);
    }
  } else {
    try {
      if (fs.existsSync(localUploadsDir)) {
        const files = fs.readdirSync(localUploadsDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const meta = JSON.parse(fs.readFileSync(path.join(localUploadsDir, file), 'utf8'));
              if (now > new Date(meta.expiresAt).getTime()) {
                fs.unlinkSync(path.join(localUploadsDir, file));
                const targetFile = path.join(localUploadsDir, meta.filename);
                if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
              } else {
                results.push(meta);
                transferCache.set(meta.transferId, meta);
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }

  results.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return results;
}

// 4. Delete transfer by identifier
async function deleteTransfer(identifier) {
  const meta = await getTransfer(identifier);
  if (!meta || meta.expired) return false;

  transferCache.delete(meta.transferId);

  if (isBlobConfigured() && meta.storageType === 'blob') {
    const urlsToDelete = [];
    if (meta.blobUrl) urlsToDelete.push(meta.blobUrl);
    try {
      const { blobs } = await list({
        prefix: `quickshare/meta/${meta.transferId}.json`,
        token: process.env.BLOB_READ_WRITE_TOKEN
      });
      blobs.forEach((b) => urlsToDelete.push(b.url));
      if (urlsToDelete.length > 0) {
        await del(urlsToDelete, { token: process.env.BLOB_READ_WRITE_TOKEN });
      }
      return true;
    } catch (e) {
      return false;
    }
  } else {
    const metaPath = path.join(localUploadsDir, `${meta.transferId}.json`);
    const fPath = path.join(localUploadsDir, meta.filename);
    try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); } catch (e) {}
    try { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); } catch (e) {}
    return true;
  }
}

// =========================================================================
// EXPRESS MIDDLEWARES & ROUTER
// =========================================================================

app.use(cors());
app.use(express.json());

// Memory storage for Multer (safe for serverless & high performance)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
}).single('file');

const apiRouter = express.Router();

// 1. Health check
apiRouter.get('/health', async (req, res) => {
  const transfers = await getAllTransfers();
  res.json({
    status: 'ok',
    message: 'QuickShare API is active',
    storageMode: isBlobConfigured() ? 'Vercel Blob (Persistent)' : 'Local Disk / Temp',
    maxFileSizeMB: 25,
    expiryHours: 24,
    activeTransfers: transfers.length
  });
});

// 2. Upload Single File
apiRouter.post('/upload', (req, res) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'File too large',
          message: 'The selected file exceeds the 25 MB limit for QuickShare.'
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          error: 'Too many files',
          message: 'Please upload only one file at a time.'
        });
      }
      return res.status(400).json({ error: 'Upload error', message: err.message });
    } else if (err) {
      return res.status(500).json({
        error: 'Server error',
        message: 'An unexpected error occurred while processing the file.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'Missing file',
        message: 'No file was provided in the request. Please choose a file to upload.'
      });
    }

    try {
      const transferId = generateTransferId();
      const fileData = await saveTransfer({
        transferId,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        buffer: req.file.buffer,
        size: req.file.size
      });

      return res.status(201).json({
        message: 'File uploaded successfully! Available for 24 hours.',
        transferId: fileData.transferId,
        expiresAt: fileData.expiresAt,
        file: fileData
      });
    } catch (saveError) {
      console.error('Storage save error:', saveError);
      return res.status(500).json({
        error: 'Storage error',
        message: 'Failed to persist uploaded file to storage.'
      });
    }
  });
});

// 3. List all active files/transfers
apiRouter.get('/files', async (req, res) => {
  const files = await getAllTransfers();
  res.json({ files, count: files.length });
});

// 4. Get transfer by Transfer ID
apiRouter.get('/transfer/:transferId', async (req, res) => {
  const { transferId } = req.params;
  const fileData = await getTransfer(transferId);

  if (!fileData) {
    return res.status(404).json({
      error: 'Transfer not found',
      message: `The transfer with ID "${transferId}" is invalid, expired, or unavailable.`
    });
  }

  if (fileData.expired) {
    return res.status(410).json({
      error: 'Transfer expired',
      message: 'This transfer expired after 24 hours and has been permanently removed.'
    });
  }

  res.json({ transfer: fileData });
});

// 4b. Download directly by Transfer ID
apiRouter.get('/transfer/:transferId/download', async (req, res) => {
  const { transferId } = req.params;
  const fileData = await getTransfer(transferId);

  if (!fileData) {
    return res.status(404).json({
      error: 'Transfer not found',
      message: `The transfer with ID "${transferId}" is invalid, expired, or unavailable.`
    });
  }

  if (fileData.expired) {
    return res.status(410).json({
      error: 'Transfer expired',
      message: 'This file transfer expired after 24 hours and has been removed.'
    });
  }

  if (fileData.storageType === 'blob' && fileData.blobUrl) {
    // Stream or redirect to Blob URL with download header
    try {
      const blobFetch = await fetch(fileData.blobUrl);
      if (blobFetch.ok) {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(fileData.originalname)}"`
        );
        res.setHeader('Content-Type', fileData.mimetype || 'application/octet-stream');
        const arrayBuf = await blobFetch.arrayBuffer();
        return res.send(Buffer.from(arrayBuf));
      }
    } catch (e) {}
    // Fallback: direct redirect
    return res.redirect(fileData.blobDownloadUrl || fileData.blobUrl);
  } else {
    // Local disk download
    const filePath = path.join(localUploadsDir, fileData.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'File missing',
        message: 'The file for this transfer is no longer available on the server.'
      });
    }

    res.download(filePath, fileData.originalname, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Download error', message: 'Could not stream file download.' });
      }
    });
  }
});

// 5. Download file by filename (legacy compatibility)
apiRouter.get('/files/:filename/download', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const transfers = await getAllTransfers();
  const fileData = transfers.find((t) => t.filename === filename);

  if (!fileData) {
    return res.status(404).json({
      error: 'File not found',
      message: 'The requested file could not be found or has expired.'
    });
  }

  if (fileData.storageType === 'blob' && fileData.blobUrl) {
    return res.redirect(fileData.blobDownloadUrl || fileData.blobUrl);
  } else {
    const filePath = path.join(localUploadsDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found', message: 'File missing on server.' });
    }
    res.download(filePath, fileData.originalname);
  }
});

// 6. View / Stream file inline (for previewing images, videos, PDFs)
apiRouter.get('/files/:filename/view', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const transfers = await getAllTransfers();
  const fileData = transfers.find((t) => t.filename === filename);

  if (fileData && fileData.storageType === 'blob' && fileData.blobUrl) {
    return res.redirect(fileData.blobUrl);
  }

  const filePath = path.join(localUploadsDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'File not found',
      message: 'The requested file could not be found or has expired.'
    });
  }

  if (fileData && fileData.mimetype) {
    res.setHeader('Content-Type', fileData.mimetype);
  }
  res.sendFile(filePath);
});

// 7. Delete file by identifier
apiRouter.delete('/files/:identifier', async (req, res) => {
  const { identifier } = req.params;
  const success = await deleteTransfer(identifier);

  if (!success) {
    return res.status(404).json({ error: 'Not found', message: 'File does not exist or has expired.' });
  }

  res.json({ message: 'File deleted successfully', identifier });
});

// Mount router on both '/api' and '/' for complete Vercel / local compatibility
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Start Server if run directly (local node server)
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 QuickShare Backend running at http://localhost:${PORT}`);
    console.log(
      `📁 Storage Mode: ${isBlobConfigured() ? 'Vercel Blob (Persistent)' : 'Local Disk / Temp (' + localUploadsDir + ')'}`
    );
  });
}

export default app;
