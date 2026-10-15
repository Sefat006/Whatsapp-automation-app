# WhatsApp Bulk Messenger

A web-based bulk WhatsApp messaging automation tool with anti-ban mechanisms, batching, and live delivery status.

## 🚀 Features

- **Web Dashboard**: Clean UI to scan QR code, input numbers, write messages, and monitor live progress.
- **Auto Phone Number Normalization**: Automatically converts BD phone numbers (e.g., `017XXXXXXXX`, `+88017XXXXXXXX`) to standard international format (`8801XXXXXXXXX`).
- **Anti-Ban Protections**:
  - Random delay between messages (10–30s).
  - Dynamic batches (20–30 messages per batch).
  - Cooldown pause between batches (10–20 minutes).
- **Background Queue Execution**: Jobs run reliably in the background even if the browser tab is closed.

## 🛠️ Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- Google Chrome or Chromium installed on your system

## 📦 Installation

1. Clone this repository:
   ```bash
   git clone <your-repo-url>
   cd wa-automation
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## ▶️ Running the Application

1. Start the server:
   ```bash
   npm start
   ```

2. Open your browser and go to:
   ```
   http://localhost:3000
   ```

3. Scan the QR code using WhatsApp on your phone (Linked Devices).
4. Enter comma-separated phone numbers, type your message, and hit send!

## ⚙️ Configuration (Optional)

You can customize the port by creating a `.env` file:
```env
PORT=3000
```

## 📄 License

This project is licensed under the [MIT License](LICENSE).

