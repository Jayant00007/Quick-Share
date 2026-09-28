# QuickShare 🚀

**QuickShare** is a modern, lightweight, peer-friendly file-sharing web application built with **React (Vite)** on the frontend and **Node.js (Express & Multer)** on the backend.

---

## ⚡ Key Features

- **Single-File Upload (up to 25 MB)**: Drag & drop or browse to select any file format.
- **Real-Time Upload Progress**: Accurate progress bar with percentage readout during upload.
- **Unique Transfer IDs**: Every upload receives a unique ID (e.g. `qs-58406437`).
- **24-Hour Expiration & Auto-Cleanup**: Files automatically expire after 24 hours and are permanently deleted from server storage.
- **Dedicated Download Pages**: Clean, shareable download links (`/download/:transferId`) with 1-click **Copy Link** buttons.
- **Safe 404/410 Handling**: Informative unavailable/expired file states instead of blank pages.
- **Responsive Design**: Polished glassmorphic UI optimized for mobile and desktop viewports.

---

## 📁 Project Structure

```text
QuickShare/
├── backend/
│   ├── uploads/            # Temporary storage for active files (auto-cleaned)
│   ├── package.json        # Express, Cors, Multer
│   └── server.js           # REST API with 24h expiration & download streaming
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # React UI (Homepage + Download Page views)
│   │   ├── App.css         # Responsive styling, animations & theme
│   │   ├── index.css       # Global design tokens
│   │   └── main.jsx        # App entry point
│   ├── index.html          # HTML template with Google Fonts
│   ├── package.json        # React, Vite, Lucide Icons
│   └── vite.config.js      # Proxy configuration to backend port 5001
└── README.md
```

---

## 🚀 Quick Start Instructions

Open **two terminal windows**:

### Step 1: Start the Backend Server (Terminal 1)
```bash
cd backend
npm install
npm start
```
> 🌐 Backend runs at: **`http://localhost:5001`**

---

### Step 2: Start the Frontend App (Terminal 2)
```bash
cd frontend
npm install
npm run dev
```
> 💻 Frontend opens at: **`http://localhost:5173`**

---

## 🧪 Testing the Flow

1. Open **`http://localhost:5173`** in your browser.
2. Select or drag-and-drop any file under 25 MB.
3. Click **Upload File to Server** and watch the real-time progress bar.
4. Click **Copy Link** to copy the shareable download URL (e.g., `http://localhost:5173/download/qs-xxxx`).
5. Open the copied link in a new browser tab to view the download card and click **Download File**.
6. Try visiting an invalid ID like `http://localhost:5173/download/qs-invalid` to verify the **Transfer Unavailable** state.
