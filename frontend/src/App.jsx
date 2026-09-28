import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  File,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Code,
  Download,
  Trash2,
  Copy,
  Check,
  Search,
  ExternalLink,
  Share2,
  AlertCircle,
  X,
  RefreshCw,
  FolderOpen,
  Zap,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  FileQuestion,
  Home,
  ArrowLeft,
  Clock,
  Sparkles
} from 'lucide-react';
import './App.css';

// Maximum size: 25 MB
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// Utility: format file size
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Utility: format relative / human date
function formatDate(dateString) {
  if (!dateString) return 'Just now';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Utility: calculate remaining time until 24h expiry
function formatTimeRemaining(expiresAtString) {
  if (!expiresAtString) return '24 hours';
  const expiry = new Date(expiresAtString).getTime();
  const now = Date.now();
  const diffMs = expiry - now;

  if (diffMs <= 0) return 'Expired';

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours > 0) {
    return `${diffHours}h ${diffMins}m left`;
  }
  return `${diffMins}m left`;
}

// Utility: get icon & class for file type
function getFileIcon(filename = '', mimetype = '') {
  const ext = filename.split('.').pop().toLowerCase();
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimetype.startsWith('image/')) {
    return { icon: <ImageIcon size={26} />, className: 'icon-image', label: 'IMAGE' };
  }
  if (ext === 'pdf' || mimetype.includes('pdf')) {
    return { icon: <FileText size={26} />, className: 'icon-pdf', label: 'PDF' };
  }
  if (['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext) || mimetype.startsWith('video/')) {
    return { icon: <Film size={26} />, className: 'icon-video', label: 'VIDEO' };
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext) || mimetype.startsWith('audio/')) {
    return { icon: <Music size={26} />, className: 'icon-audio', label: 'AUDIO' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { icon: <Archive size={26} />, className: 'icon-archive', label: 'ARCHIVE' };
  }
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css', 'json', 'cpp', 'java', 'sql', 'md'].includes(ext)) {
    return { icon: <Code size={26} />, className: 'icon-code', label: 'CODE' };
  }
  return { icon: <File size={26} />, className: 'icon-other', label: 'FILE' };
}

// Extract transferId from current URL (supports /download/:id, /transfer/:id, or ?transfer=:id)
function getTransferIdFromUrl() {
  const pathname = window.location.pathname;
  const pathMatch = pathname.match(/^\/(?:download|transfer)\/([a-zA-Z0-9_-]+)/i);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('transfer') || params.get('id') || null;
}

export default function App() {
  // Navigation & View State
  const [currentTransferId, setCurrentTransferId] = useState(getTransferIdFromUrl());

  // Home Page State
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [latestTransfer, setLatestTransfer] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [serverOnline, setServerOnline] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Download Page State
  const [downloadFileData, setDownloadFileData] = useState(null);
  const [isLoadingDownload, setIsLoadingDownload] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const fileInputRef = useRef(null);

  // Show Toast
  const addToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Synchronize with URL changes (back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      setCurrentTransferId(getTransferIdFromUrl());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Fetch files list for home page
  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        setServerOnline(true);
      } else {
        setServerOnline(false);
      }
    } catch (err) {
      setServerOnline(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(fetchFiles, 6000);
    return () => clearInterval(interval);
  }, []);

  // Fetch specific transfer details when viewing Download page
  useEffect(() => {
    if (!currentTransferId) {
      setDownloadFileData(null);
      setDownloadError(null);
      return;
    }

    let isMounted = true;
    setIsLoadingDownload(true);
    setDownloadError(null);

    fetch(`/api/transfer/${encodeURIComponent(currentTransferId)}`)
      .then(async (res) => {
        if (!isMounted) return;
        if (res.ok) {
          const data = await res.json();
          setDownloadFileData(data.transfer);
          setDownloadError(null);
        } else {
          const errorData = await res.json().catch(() => ({}));
          setDownloadError(
            errorData.message ||
              `The transfer with ID "${currentTransferId}" was not found or has expired.`
          );
          setDownloadFileData(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDownloadError('Unable to connect to server. Please check your network connection.');
          setDownloadFileData(null);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingDownload(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentTransferId]);

  // Navigate to download page or home page
  const navigateTo = (path, transferId = null) => {
    window.history.pushState({}, '', path);
    setCurrentTransferId(transferId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Validate and set chosen file (one file at a time, max 25MB)
  const processSelectedFile = (file) => {
    setUploadError(null);
    setLatestTransfer(null);
    setUploadProgress(0);

    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeFormatted = formatBytes(file.size);
      const errorMsg = `"${file.name}" is ${sizeFormatted}, which exceeds the 25 MB limit for this workshop demo.`;
      setUploadError(errorMsg);
      addToast(errorMsg, 'error');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
  };

  // Handle Drag & Drop
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (e.dataTransfer.files.length > 1) {
        addToast('Only 1 file allowed per upload. Selected first file.', 'error');
      }
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setUploadError(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Upload Single File with Real XMLHttpRequest Progress
  const handleUpload = () => {
    if (!selectedFile) return;

    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      const errorMsg = 'Cannot upload: File exceeds the 25 MB limit.';
      setUploadError(errorMsg);
      addToast(errorMsg, 'error');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    // Track real upload progress
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadProgress(100);
          setLatestTransfer(response);
          addToast(`Upload complete! Transfer ID: ${response.transferId}`, 'success');
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          fetchFiles();
        } else {
          const errorMsg = response.message || response.error || `Upload failed (Status ${xhr.status})`;
          setUploadError(errorMsg);
          addToast(errorMsg, 'error');
        }
      } catch (e) {
        const errorMsg = `Upload failed with status ${xhr.status}`;
        setUploadError(errorMsg);
        addToast(errorMsg, 'error');
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      const errorMsg = 'Network error: Unable to connect to Express backend. Is the server running on port 5001?';
      setUploadError(errorMsg);
      addToast(errorMsg, 'error');
    };

    xhr.send(formData);
  };

  // Delete file
  const handleDelete = async (filename, originalname) => {
    if (!window.confirm(`Delete "${originalname}" from server?`)) return;

    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.filename !== filename));
        if (latestTransfer && latestTransfer.file && latestTransfer.file.filename === filename) {
          setLatestTransfer(null);
        }
        if (downloadFileData && downloadFileData.filename === filename) {
          setDownloadFileData(null);
          setDownloadError('This file has been deleted.');
        }
        addToast(`Deleted "${originalname}"`, 'success');
      } else {
        addToast('Failed to delete file', 'error');
      }
    } catch (err) {
      addToast('Network error during deletion', 'error');
    }
  };

  // Copy text to clipboard helper
  const copyToClipboard = (text, id, label = 'Copied to clipboard!') => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    addToast(label, 'success');
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  // Filtered files
  const filteredFiles = files.filter((file) =>
    file.originalname.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (file.transferId && file.transferId.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const selectedTypeInfo = selectedFile ? getFileIcon(selectedFile.name, selectedFile.type) : null;

  return (
    <div className="quickshare-app">
      {/* Background ambient lighting */}
      <div className="ambient-glow glow-1" />
      <div className="ambient-glow glow-2" />

      {/* Top Navigation */}
      <header className="navbar">
        <div className="nav-container">
          <div
            className="brand-logo clickable"
            onClick={() => navigateTo('/', null)}
            title="Go to QuickShare Homepage"
          >
            <div className="logo-badge">
              <Zap size={22} className="logo-icon" />
            </div>
            <div className="brand-text">
              <span className="brand-name">QuickShare</span>
              <span className="brand-pill">24H EXPIRY</span>
            </div>
          </div>

          <div className="nav-actions">
            {currentTransferId && (
              <button
                type="button"
                className="nav-home-btn"
                onClick={() => navigateTo('/', null)}
              >
                <Home size={15} />
                <span>Upload a File</span>
              </button>
            )}

            <div className={`server-pill ${serverOnline ? 'online' : 'offline'}`}>
              <span className="pulse-indicator" />
              <span>{serverOnline ? 'Express API Online' : 'API Offline'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {/* ========================================================= */}
        {/* VIEW 1: DEDICATED DOWNLOAD PAGE FOR /download/:transferId */}
        {/* ========================================================= */}
        {currentTransferId ? (
          <section className="download-page-view animate-fade-in">
            <button
              type="button"
              className="back-link-btn"
              onClick={() => navigateTo('/', null)}
            >
              <ArrowLeft size={16} />
              <span>Back to QuickShare</span>
            </button>

            {isLoadingDownload ? (
              <div className="download-loading-card">
                <div className="loading-pulse-ring">
                  <RefreshCw size={36} className="spin-animation download-spinner" />
                </div>
                <h3 className="loading-title">Retrieving File Transfer...</h3>
                <p className="loading-subtitle">
                  Connecting to secure storage for ID: <code>{currentTransferId}</code>
                </p>
              </div>
            ) : downloadError ? (
              <div className="download-error-card animate-fade-in">
                <div className="error-icon-box">
                  <FileQuestion size={44} />
                </div>
                <h2 className="download-error-title">Transfer Unavailable</h2>
                <p className="download-error-desc">{downloadError}</p>
                <div className="error-actions">
                  <button
                    type="button"
                    className="btn-primary-action"
                    onClick={() => navigateTo('/', null)}
                  >
                    <UploadCloud size={18} />
                    <span>Upload a New File</span>
                  </button>
                </div>
              </div>
            ) : downloadFileData ? (
              <div className="download-card animate-fade-in">
                <div className="download-card-header">
                  <div className="download-badge-tag">
                    <ShieldCheck size={14} />
                    <span>VERIFIED TRANSFER</span>
                  </div>
                  <div className="expiry-indicator-pill">
                    <Clock size={13} />
                    <span>{formatTimeRemaining(downloadFileData.expiresAt)}</span>
                  </div>
                </div>

                <div className="download-file-hero">
                  <div
                    className={`download-type-large ${
                      getFileIcon(downloadFileData.originalname, downloadFileData.mimetype).className
                    }`}
                  >
                    {getFileIcon(downloadFileData.originalname, downloadFileData.mimetype).icon}
                  </div>

                  <h1 className="download-filename" title={downloadFileData.originalname}>
                    {downloadFileData.originalname}
                  </h1>

                  <div className="download-file-stats">
                    <span className="stat-pill">{formatBytes(downloadFileData.size)}</span>
                    <span className="dot-sep">•</span>
                    <span>Uploaded {formatDate(downloadFileData.uploadedAt)}</span>
                  </div>
                </div>

                {/* Primary Download Button */}
                <div className="download-actions-block">
                  <a
                    href={`/api/transfer/${encodeURIComponent(downloadFileData.transferId)}/download`}
                    className="btn-download-hero"
                    download={downloadFileData.originalname}
                  >
                    <Download size={20} />
                    <span>Download File ({formatBytes(downloadFileData.size)})</span>
                  </a>

                  <div className="download-secondary-actions">
                    <a
                      href={`/api/files/${encodeURIComponent(downloadFileData.filename)}/view`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary-action"
                      title="Preview in new tab"
                    >
                      <ExternalLink size={16} />
                      <span>Preview File</span>
                    </a>

                    <button
                      type="button"
                      className="btn-secondary-action"
                      onClick={() =>
                        copyToClipboard(
                          window.location.href,
                          'share-page-link',
                          'Download page link copied!'
                        )
                      }
                    >
                      {copiedId === 'share-page-link' ? (
                        <>
                          <Check size={16} color="#10b981" />
                          <span>Link Copied!</span>
                        </>
                      ) : (
                        <>
                          <Share2 size={16} />
                          <span>Share Page Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          /* ========================================================= */
          /* VIEW 2: HOMEPAGE (HERO, UPLOAD CARD, RECENT TRANSFERS)    */
          /* ========================================================= */
          <>
            {/* Hero Section */}
            <section className="hero-section">
              <div className="hero-badge">
                <ShieldCheck size={14} />
                <span>Single-File Transfer • 25 MB Limit • 24-Hour Auto Expiry</span>
              </div>

              <h1 className="hero-title">
                Effortless file sharing, <br />
                <span className="gradient-text">lightning fast.</span>
              </h1>

              <p className="hero-subtitle">
                Upload your file to generate a unique Transfer ID and dedicated download page. Files are automatically cleaned up after 24 hours.
              </p>
            </section>

            {/* Transfer Box / Upload Card */}
            <section className="transfer-card">
              {/* Dropzone Area */}
              <div
                className={`dropzone-box ${isDragging ? 'is-dragging' : ''} ${
                  selectedFile ? 'has-files' : ''
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isUploading && fileInputRef.current && fileInputRef.current.click()}
              >
                <div className="dropzone-inner">
                  <div className="icon-circle">
                    <UploadCloud size={38} className="cloud-icon" />
                  </div>

                  <h2 className="dropzone-heading">
                    {isDragging
                      ? 'Drop your file right here'
                      : selectedFile
                      ? 'File ready to upload'
                      : 'Drag & drop your file here'}
                  </h2>

                  <p className="dropzone-subtext">
                    Accepts 1 file at a time • Maximum size: <strong>25 MB</strong> • 24h Expiry
                  </p>

                  <button
                    type="button"
                    className="choose-file-btn"
                    disabled={isUploading}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current && fileInputRef.current.click();
                    }}
                  >
                    <FolderOpen size={18} />
                    <span>{selectedFile ? 'Change File' : 'Choose File'}</span>
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileInputChange}
                    multiple={false}
                    className="hidden-file-input"
                  />
                </div>
              </div>

              {/* Inline Error Message */}
              {uploadError && (
                <div className="error-banner animate-fade-in">
                  <AlertCircle size={18} className="error-banner-icon" />
                  <div className="error-banner-content">
                    <strong className="error-banner-title">Upload Warning</strong>
                    <p className="error-banner-text">{uploadError}</p>
                  </div>
                  <button
                    type="button"
                    className="error-banner-close"
                    onClick={() => setUploadError(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              {/* Selected File Details */}
              {selectedFile && (
                <div className="selection-panel animate-fade-in">
                  <div className="selection-header">
                    <div className="selection-title-group">
                      <span className="selection-badge">Selected File</span>
                      <span className="selection-total-size">{formatBytes(selectedFile.size)}</span>
                    </div>

                    <div className="selection-controls">
                      <button
                        type="button"
                        className="btn-clear"
                        onClick={clearSelectedFile}
                        disabled={isUploading}
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>

                  {/* File Info Row */}
                  <div className="selected-file-row">
                    <div className="selected-file-main">
                      <div className={`selected-type-badge ${selectedTypeInfo.className}`}>
                        {selectedTypeInfo.icon}
                      </div>
                      <div className="selected-file-details">
                        <span className="selected-filename" title={selectedFile.name}>
                          {selectedFile.name}
                        </span>
                        <span className="selected-filesize">
                          {formatBytes(selectedFile.size)} • {selectedFile.type || 'Binary File'}
                        </span>
                      </div>
                    </div>

                    {!isUploading && (
                      <button
                        type="button"
                        className="btn-remove-file"
                        onClick={clearSelectedFile}
                        title="Remove file"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Progress Bar while Uploading */}
                  {isUploading && (
                    <div className="progress-container animate-fade-in">
                      <div className="progress-info">
                        <span className="progress-label">
                          <RefreshCw size={14} className="spin-animation" />
                          Uploading to Express backend...
                        </span>
                        <span className="progress-percent">{uploadProgress}%</span>
                      </div>
                      <div className="progress-bar-track">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Upload Action Button */}
                  <div className="upload-cta-bar">
                    <button
                      type="button"
                      className="upload-submit-btn"
                      onClick={handleUpload}
                      disabled={isUploading || !selectedFile}
                    >
                      {isUploading ? (
                        <>
                          <RefreshCw size={18} className="spin-animation" />
                          <span>Uploading ({uploadProgress}%)...</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={18} />
                          <span>Upload File to Server</span>
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Success Banner / Shareable Link & Transfer ID */}
              {latestTransfer && latestTransfer.file && (
                <div className="success-transfer-card animate-fade-in">
                  <div className="success-badge-row">
                    <div className="success-icon-badge">
                      <Check size={20} />
                    </div>
                    <div>
                      <h3 className="success-title">Upload Successful!</h3>
                      <p className="success-subtitle">
                        Your file is ready to share. Available for 24 hours.
                      </p>
                    </div>
                  </div>

                  {/* Shareable Link Box with Copy Button */}
                  <div className="shareable-link-container">
                    <div className="shareable-link-header">
                      <span className="shareable-link-label">SHAREABLE DOWNLOAD LINK</span>
                      <span className="expiry-hint">
                        <Clock size={12} />
                        Expires in 24 hours
                      </span>
                    </div>
                    <div className="shareable-link-box">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/download/${latestTransfer.transferId}`}
                        className="shareable-link-input"
                      />
                      <button
                        type="button"
                        className="btn-copy-link-highlight"
                        onClick={() => {
                          const pageLink = `${window.location.origin}/download/${latestTransfer.transferId}`;
                          copyToClipboard(pageLink, 'shareable-link', 'Shareable link copied!');
                        }}
                      >
                        {copiedId === 'shareable-link' ? (
                          <>
                            <Check size={16} color="#10b981" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={16} />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Transfer ID & Actions */}
                  <div className="transfer-id-display">
                    <div className="transfer-id-info">
                      <span className="id-label">UNIQUE TRANSFER ID</span>
                      <span className="id-value">
                        <KeyRound size={15} />
                        {latestTransfer.transferId}
                      </span>
                    </div>
                    <div className="transfer-id-actions">
                      <button
                        type="button"
                        className="btn-copy-id"
                        onClick={() =>
                          copyToClipboard(
                            latestTransfer.transferId,
                            `id-${latestTransfer.transferId}`,
                            'Transfer ID copied!'
                          )
                        }
                      >
                        {copiedId === `id-${latestTransfer.transferId}` ? (
                          <>
                            <Check size={14} color="#10b981" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            <span>Copy ID</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="success-action-row">
                    <button
                      type="button"
                      className="btn-open-download-page"
                      onClick={() =>
                        navigateTo(
                          `/download/${latestTransfer.transferId}`,
                          latestTransfer.transferId
                        )
                      }
                    >
                      <ExternalLink size={16} />
                      <span>Open Download Page</span>
                    </button>

                    <a
                      href={`/api/files/${encodeURIComponent(latestTransfer.file.filename)}/view`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-preview-transfer"
                    >
                      <ExternalLink size={16} />
                      <span>Preview File</span>
                    </a>
                  </div>
                </div>
              )}
            </section>

            {/* Feature Highlights Grid */}
            <section className="features-grid">
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <div>
                  <h3 className="feature-heading">25 MB Limit</h3>
                  <p className="feature-desc">Single-file transfers designed for fast delivery and demos.</p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon">⏳</div>
                <div>
                  <h3 className="feature-heading">24-Hour Expiry</h3>
                  <p className="feature-desc">Files auto-expire to keep server storage clean and private.</p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon">🔗</div>
                <div>
                  <h3 className="feature-heading">Dedicated Pages</h3>
                  <p className="feature-desc">Clean, shareable download links for any recipient.</p>
                </div>
              </div>
            </section>

            {/* Uploaded Files Library */}
            <section className="library-section">
              <div className="library-header">
                <div className="library-title-group">
                  <h2 className="library-title">Recent Transfers</h2>
                  <span className="library-count">{files.length}</span>
                </div>

                <div className="library-search-wrapper">
                  <Search size={16} className="search-icon" />
                  <input
                    type="text"
                    placeholder="Search by name or Transfer ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="library-search-input"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="btn-clear-search"
                      onClick={() => setSearchQuery('')}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Files Grid or Empty State */}
              {filteredFiles.length === 0 ? (
                <div className="empty-files-card">
                  <div className="empty-icon-wrap">
                    <File size={32} />
                  </div>
                  <h3 className="empty-heading">
                    {searchQuery ? 'No matching transfers found' : 'No active transfers yet'}
                  </h3>
                  <p className="empty-subtext">
                    {searchQuery
                      ? `No transfers matching "${searchQuery}".`
                      : 'Select a file up to 25 MB above to perform your first transfer.'}
                  </p>
                </div>
              ) : (
                <div className="files-grid">
                  {filteredFiles.map((file) => {
                    const typeInfo = getFileIcon(file.originalname, file.mimetype);
                    const pageLink = `${window.location.origin}/download/${file.transferId}`;
                    const isCopiedLink = copiedId === `link-${file.filename}`;
                    const isCopiedId = copiedId === `id-${file.transferId}`;

                    return (
                      <div key={file.filename} className="file-item-card animate-fade-in">
                        <div className="file-item-header">
                          <div className={`file-type-box ${typeInfo.className}`}>
                            {typeInfo.icon}
                          </div>
                          <div className="file-item-meta">
                            <span className="file-item-name" title={file.originalname}>
                              {file.originalname}
                            </span>
                            <div className="file-item-subline">
                              <span>{formatBytes(file.size)}</span>
                              <span className="dot-sep">•</span>
                              <span className="expiry-text">
                                <Clock size={11} />
                                {formatTimeRemaining(file.expiresAt)}
                              </span>
                            </div>
                            {file.transferId && (
                              <div className="file-transfer-id-pill" title="Transfer ID">
                                <span>ID: {file.transferId}</span>
                                <button
                                  type="button"
                                  className="btn-mini-copy"
                                  onClick={() =>
                                    copyToClipboard(
                                      file.transferId,
                                      `id-${file.transferId}`,
                                      'Transfer ID copied!'
                                    )
                                  }
                                >
                                  {isCopiedId ? <Check size={11} color="#10b981" /> : <Copy size={11} />}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="file-item-actions">
                          <button
                            type="button"
                            className={`action-btn-share ${isCopiedLink ? 'copied' : ''}`}
                            onClick={() => {
                              copyToClipboard(pageLink, `link-${file.filename}`, 'Shareable download link copied!');
                            }}
                            title="Copy shareable link"
                          >
                            {isCopiedLink ? <Check size={14} /> : <Copy size={14} />}
                            <span>{isCopiedLink ? 'Copied' : 'Share Link'}</span>
                          </button>

                          <div className="action-btn-cluster">
                            <button
                              type="button"
                              className="action-icon-btn"
                              title="Open Download Page"
                              onClick={() => navigateTo(`/download/${file.transferId}`, file.transferId)}
                            >
                              <ExternalLink size={15} />
                            </button>

                            <a
                              href={`/api/files/${encodeURIComponent(file.filename)}/download`}
                              className="action-icon-btn"
                              download={file.originalname}
                              title="Direct download file"
                            >
                              <Download size={15} />
                            </a>

                            <button
                              type="button"
                              className="action-icon-btn delete"
                              onClick={() => handleDelete(file.filename, file.originalname)}
                              title="Delete file"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Floating Toast Notification Container */}
      <div className="toast-portal">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-bubble ${toast.type}`}>
            {toast.type === 'error' ? (
              <AlertCircle size={18} className="toast-icon error" />
            ) : (
              <Check size={18} className="toast-icon success" />
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
