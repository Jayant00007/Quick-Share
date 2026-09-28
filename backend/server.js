import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
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

// Temporary upload directory setup (support Vercel /tmp)
const uploadsDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'quickshare-uploads')
  : path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// In-memory file registry for fast lookup
const transferRegistry = new Map();
const filenameRegistry = new Map();

// Helper: load transfer metadata by ID from memory or disk
function getTransferData(transferId) {
  if (!transferId) return null;
  // 1. Check in-memory map
  let data = transferRegistry.get(transferId);
  if (data) return data;

  // 2. Check disk metadata file
  const safeId = String(transferId).replace(/[^a-zA-Z0-9_-]/g, '');
  const metaPath = path.join(uploadsDir, `${safeId}.json`);
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const filePath = path.join(uploadsDir, parsed.filename);
      if (fs.existsSync(filePath)) {
        transferRegistry.set(parsed.transferId, parsed);
        filenameRegistry.set(parsed.filename, parsed);
        return parsed;
      }
    } catch (e) {
      console.error(`Error reading metadata for ${transferId}:`, e);
    }
  }
  return null;
}

// Helper: load transfer metadata by filename from memory or disk
function getTransferByFilename(filename) {
  if (!filename) return null;
  let data = filenameRegistry.get(filename);
  if (data) return data;

  try {
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const parsed = JSON.parse(fs.readFileSync(path.join(uploadsDir, file), 'utf8'));
            if (parsed.filename === filename) {
              transferRegistry.set(parsed.transferId, parsed);
              filenameRegistry.set(parsed.filename, parsed);
              return parsed;
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  return null;
}

// Helper: list all active transfers from disk and memory
function getAllActiveTransfers() {
  cleanupExpiredFiles();
  const now = Date.now();
  const transfersMap = new Map();

  // Load all .json files from uploadsDir
  try {
    if (fs.existsSync(uploadsDir)) {
      const diskFiles = fs.readdirSync(uploadsDir);
      for (const file of diskFiles) {
        if (file.endsWith('.json')) {
          try {
            const parsed = JSON.parse(fs.readFileSync(path.join(uploadsDir, file), 'utf8'));
            const expiryTime = new Date(parsed.expiresAt).getTime();
            const filePath = path.join(uploadsDir, parsed.filename);
            if (now < expiryTime && fs.existsSync(filePath)) {
              transfersMap.set(parsed.transferId, parsed);
              transferRegistry.set(parsed.transferId, parsed);
              filenameRegistry.set(parsed.filename, parsed);
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  // Include in-memory entries if file exists
  for (const [id, data] of transferRegistry.entries()) {
    const expiryTime = new Date(data.expiresAt).getTime();
    const filePath = path.join(uploadsDir, data.filename);
    if (now < expiryTime && fs.existsSync(filePath)) {
      transfersMap.set(id, data);
    }
  }

  const result = Array.from(transfersMap.values()).map((file) => ({
    ...file,
    downloadUrl: `/api/files/${encodeURIComponent(file.filename)}/download`,
    transferDownloadUrl: `/api/transfer/${encodeURIComponent(file.transferId)}/download`,
    viewUrl: `/api/files/${encodeURIComponent(file.filename)}/view`
  }));

  result.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return result;
}

// Generate unique, readable transfer ID (e.g., qs-4a8f9c2e)
function generateTransferId() {
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `qs-${randomHex}`;
}

// Expired Files Cleaner
function cleanupExpiredFiles() {
  const now = Date.now();
  let expiredCount = 0;

  // 1. Clean from memory & disk
  for (const [transferId, fileData] of Array.from(transferRegistry.entries())) {
    const expiryTime = new Date(fileData.expiresAt).getTime();
    if (now > expiryTime) {
      const filePath = path.join(uploadsDir, fileData.filename);
      const metaPath = path.join(uploadsDir, `${fileData.transferId}.json`);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      if (fs.existsSync(metaPath)) {
        try { fs.unlinkSync(metaPath); } catch (e) {}
      }
      transferRegistry.delete(transferId);
      filenameRegistry.delete(fileData.filename);
      expiredCount++;
    }
  }

  // 2. Also clean any expired json or files directly on disk
  try {
    if (fs.existsSync(uploadsDir)) {
      const diskFiles = fs.readdirSync(uploadsDir);
      for (const file of diskFiles) {
        const filePath = path.join(uploadsDir, file);
        if (file.endsWith('.json')) {
          try {
            const meta = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (now > new Date(meta.expiresAt).getTime()) {
              fs.unlinkSync(filePath);
              const targetFile = path.join(uploadsDir, meta.filename);
              if (fs.existsSync(targetFile)) {
                fs.unlinkSync(targetFile);
              }
              expiredCount++;
            }
          } catch (e) {}
        } else {
          try {
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
              const fileAge = now - (stats.birthtimeMs || stats.mtimeMs);
              if (fileAge > EXPIRY_DURATION_MS) {
                fs.unlinkSync(filePath);
                expiredCount++;
              }
            }
          } catch (e) {}
        }
      }
    }
  } catch (err) {}

  if (expiredCount > 0) {
    console.log(`🧹 Cleaned up ${expiredCount} expired file(s)`);
  }
}

// Run periodic cleanup every 10 minutes (if long-running process)
if (!process.env.VERCEL) {
  setInterval(cleanupExpiredFiles, 10 * 60 * 1000);
}

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
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
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
  const transfers = getAllActiveTransfers();
  res.json({
    status: 'ok',
    message: 'QuickShare API is active',
    maxFileSizeMB: 25,
    expiryHours: 24,
    activeTransfers: transfers.length
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
      downloadUrl: `/api/files/${encodeURIComponent(req.file.filename)}/download`,
      transferDownloadUrl: `/api/transfer/${encodeURIComponent(transferId)}/download`,
      viewUrl: `/api/files/${encodeURIComponent(req.file.filename)}/view`
    };

    // Store in in-memory registries
    transferRegistry.set(transferId, fileData);
    filenameRegistry.set(req.file.filename, fileData);

    // Persist JSON metadata to disk for serverless/restart survivability
    try {
      const metaPath = path.join(uploadsDir, `${transferId}.json`);
      fs.writeFileSync(metaPath, JSON.stringify(fileData, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to write transfer metadata json:', e);
    }

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
  const files = getAllActiveTransfers();
  res.json({ files, count: files.length });
});

// 4. Get transfer by Transfer ID (checks 24h expiry)
app.get('/api/transfer/:transferId', (req, res) => {
  const { transferId } = req.params;
  const fileData = getTransferData(transferId);

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

  const filePath = path.join(uploadsDir, fileData.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'File missing',
      message: 'The file for this transfer is no longer available on the server.'
    });
  }

  res.json({
    transfer: {
      ...fileData,
      downloadUrl: `/api/files/${encodeURIComponent(fileData.filename)}/download`,
      transferDownloadUrl: `/api/transfer/${encodeURIComponent(fileData.transferId)}/download`,
      viewUrl: `/api/files/${encodeURIComponent(fileData.filename)}/view`
    }
  });
});

// 4b. Download directly by Transfer ID
app.get('/api/transfer/:transferId/download', (req, res) => {
  const { transferId } = req.params;
  const fileData = getTransferData(transferId);

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

  const fileInfo = getTransferByFilename(filename);
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

  const fileInfo = getTransferByFilename(filename);
  if (fileInfo && fileInfo.mimetype) {
    res.setHeader('Content-Type', fileInfo.mimetype);
  }

  res.sendFile(filePath);
});

// 7. Delete file (by filename or transfer ID)
app.delete('/api/files/:identifier', (req, res) => {
  const { identifier } = req.params;
  
  let fileData = getTransferData(identifier) || getTransferByFilename(identifier);
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
      const metaPath = path.join(uploadsDir, `${fileData.transferId}.json`);
      if (fs.existsSync(metaPath)) {
        try { fs.unlinkSync(metaPath); } catch (e) {}
      }
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

// Start Server if run directly (not serverless)
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 QuickShare Backend running at http://localhost:${PORT}`);
    console.log(`📁 File limit: 25 MB | Expiry: 24 hours | Uploads: ${uploadsDir}`);
  });
}

export default app;
