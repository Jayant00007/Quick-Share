import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// 25 MB file limit (in bytes)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// 24-Hour Expiry Duration (in milliseconds)
const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000;

// Temporary upload directory setup
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// In-memory file registry for demo storage
// Maps transferId -> file metadata & filename -> file metadata
const transferRegistry = new Map();
const filenameRegistry = new Map();

// Generate unique, readable transfer ID (e.g., qs-4a8f9c2e)
function generateTransferId() {
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `qs-${randomHex}`;
}

// Expired Files Cleaner
function cleanupExpiredFiles() {
  const now = Date.now();
  let expiredCount = 0;

  for (const [transferId, fileData] of Array.from(transferRegistry.entries())) {
    const expiryTime = new Date(fileData.expiresAt).getTime();
    if (now > expiryTime) {
      const filePath = path.join(uploadsDir, fileData.filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error(`Failed to delete expired file ${fileData.filename}:`, e);
        }
      }
      transferRegistry.delete(transferId);
      filenameRegistry.delete(fileData.filename);
      expiredCount++;
    }
  }

  // Also clean up any unindexed orphaned files older than 24 hours in uploads folder
  try {
    const diskFiles = fs.readdirSync(uploadsDir);
    for (const file of diskFiles) {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const fileAge = now - (stats.birthtimeMs || stats.mtimeMs);
        if (fileAge > EXPIRY_DURATION_MS) {
          try {
            fs.unlinkSync(filePath);
            expiredCount++;
          } catch (e) {}
        }
      }
    }
  } catch (err) {}

  if (expiredCount > 0) {
    console.log(`🧹 Cleaned up ${expiredCount} expired file(s)`);
  }
}

// Populate registry with any existing non-expired files in uploads on startup
try {
  const existingFiles = fs.readdirSync(uploadsDir);
  const now = Date.now();
  for (const filename of existingFiles) {
    const filePath = path.join(uploadsDir, filename);
    const stats = fs.statSync(filePath);
    if (stats.isFile()) {
      const createdTime = stats.birthtimeMs || stats.mtimeMs;
      const expiresAtMs = createdTime + EXPIRY_DURATION_MS;

      if (now > expiresAtMs) {
        // Expired already
        fs.unlinkSync(filePath);
      } else {
        const match = filename.match(/^\d+-(.+)$/);
        const originalname = match ? match[1] : filename;
        const transferId = generateTransferId();
        const fileData = {
          transferId,
          filename,
          originalname,
          size: stats.size,
          mimetype: 'application/octet-stream',
          uploadedAt: new Date(createdTime).toISOString(),
          expiresAt: new Date(expiresAtMs).toISOString()
        };
        transferRegistry.set(transferId, fileData);
        filenameRegistry.set(filename, fileData);
      }
    }
  }
} catch (err) {
  console.error('Notice: Could not index existing files on startup:', err);
}

// Run periodic cleanup every 10 minutes
setInterval(cleanupExpiredFiles, 10 * 60 * 1000);

// Middlewares
app.use(cors());
app.use(express.json());

// Run cleanup before handling requests
app.use((req, res, next) => {
  cleanupExpiredFiles();
  next();
});

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Unique filename with timestamp & sanitized name to prevent collisions
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueName = `${Date.now()}-${safeOriginal}`;
    cb(null, uniqueName);
  }
});

// Multer upload middleware (accepts one file at a time, max 25 MB)
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
}).single('file');

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'QuickShare API is active',
    maxFileSizeMB: 25,
    expiryHours: 24,
    activeTransfers: transferRegistry.size
  });
});

// 2. Upload Single File (with 24-hour expiry & unique transfer ID)
app.post('/api/upload', (req, res) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'File too large',
          message: 'The selected file exceeds the 25 MB limit for this workshop demo.'
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          error: 'Too many files',
          message: 'Please upload only one file at a time.'
        });
      }
      return res.status(400).json({
        error: 'Upload error',
        message: err.message
      });
    } else if (err) {
      return res.status(500).json({
        error: 'Server error',
        message: 'An unexpected error occurred while saving the file.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'Missing file',
        message: 'No file was provided in the request. Please choose a file to upload.'
      });
    }

    const transferId = generateTransferId();
    const now = Date.now();
    const uploadedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + EXPIRY_DURATION_MS).toISOString();

    const fileData = {
      transferId,
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype || 'application/octet-stream',
      uploadedAt,
      expiresAt,
      downloadUrl: `/api/files/${req.file.filename}/download`,
      transferDownloadUrl: `/api/transfer/${transferId}/download`,
      viewUrl: `/api/files/${req.file.filename}/view`
    };

    // Store in temporary in-memory registries
    transferRegistry.set(transferId, fileData);
    filenameRegistry.set(req.file.filename, fileData);

    return res.status(201).json({
      message: 'File uploaded successfully! Available for 24 hours.',
      transferId,
      expiresAt,
      file: fileData
    });
  });
});

// 3. List all active files/transfers
app.get('/api/files', (req, res) => {
  cleanupExpiredFiles();
  const files = Array.from(transferRegistry.values()).map((file) => ({
    ...file,
    downloadUrl: `/api/files/${file.filename}/download`,
    transferDownloadUrl: `/api/transfer/${file.transferId}/download`,
    viewUrl: `/api/files/${file.filename}/view`
  }));

  // Sort newest first
  files.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  res.json({ files, count: files.length });
});

// 4. Get transfer by Transfer ID (checks 24h expiry)
app.get('/api/transfer/:transferId', (req, res) => {
  const { transferId } = req.params;
  const fileData = transferRegistry.get(transferId);

  if (!fileData) {
    return res.status(404).json({
      error: 'Transfer not found',
      message: `The transfer with ID "${transferId}" is invalid, expired, or unavailable.`
    });
  }

  // Check if expired
  if (Date.now() > new Date(fileData.expiresAt).getTime()) {
    cleanupExpiredFiles();
    return res.status(410).json({
      error: 'Transfer expired',
      message: 'This transfer expired after 24 hours and has been permanently removed.'
    });
  }

  res.json({
    transfer: {
      ...fileData,
      downloadUrl: `/api/files/${fileData.filename}/download`,
      transferDownloadUrl: `/api/transfer/${fileData.transferId}/download`,
      viewUrl: `/api/files/${fileData.filename}/view`
    }
  });
});

// 4b. Download directly by Transfer ID
app.get('/api/transfer/:transferId/download', (req, res) => {
  const { transferId } = req.params;
  const fileData = transferRegistry.get(transferId);

  if (!fileData) {
    return res.status(404).json({
      error: 'Transfer not found',
      message: `The transfer with ID "${transferId}" is invalid, expired, or unavailable.`
    });
  }

  if (Date.now() > new Date(fileData.expiresAt).getTime()) {
    cleanupExpiredFiles();
    return res.status(410).json({
      error: 'Transfer expired',
      message: 'This file transfer expired after 24 hours and has been removed.'
    });
  }

  const filePath = path.join(uploadsDir, fileData.filename);
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
});

// 5. Download file by filename
app.get('/api/files/:filename/download', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'File not found',
      message: 'The requested file could not be found or has expired.'
    });
  }

  const fileInfo = filenameRegistry.get(filename);
  if (fileInfo && Date.now() > new Date(fileInfo.expiresAt).getTime()) {
    cleanupExpiredFiles();
    return res.status(410).json({
      error: 'File expired',
      message: 'This file transfer expired after 24 hours.'
    });
  }

  const downloadName = fileInfo ? fileInfo.originalname : filename;

  res.download(filePath, downloadName, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Download error', message: 'Could not stream file download.' });
    }
  });
});

// 6. View / Stream file inline (for previewing images, videos, PDFs)
app.get('/api/files/:filename/view', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'File not found',
      message: 'The requested file could not be found or has expired.'
    });
  }

  const fileInfo = filenameRegistry.get(filename);
  if (fileInfo && fileInfo.mimetype) {
    res.setHeader('Content-Type', fileInfo.mimetype);
  }

  res.sendFile(filePath);
});

// 7. Delete file (by filename or transfer ID)
app.delete('/api/files/:identifier', (req, res) => {
  const { identifier } = req.params;
  
  let fileData = transferRegistry.get(identifier) || filenameRegistry.get(identifier);
  const filename = fileData ? fileData.filename : path.basename(identifier);
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath) && !fileData) {
    return res.status(404).json({ error: 'Not found', message: 'File does not exist or has expired.' });
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fileData) {
      transferRegistry.delete(fileData.transferId);
      filenameRegistry.delete(fileData.filename);
    } else {
      filenameRegistry.delete(filename);
    }

    res.json({ message: 'File deleted successfully', filename });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 QuickShare Backend running at http://localhost:${PORT}`);
  console.log(`📁 File limit: 25 MB | Expiry: 24 hours | Uploads: ${uploadsDir}`);
});
