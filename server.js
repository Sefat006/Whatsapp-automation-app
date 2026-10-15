const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.static('public'));

let qrCodeUrl = '';
let isReady = false;

// ------------------------------------------------------------------
// Background send-job state. This is the single source of truth for
// the bulk-send queue. It lives purely on the server, so the job
// keeps running (batches, delays, breaks) even if every browser tab
// pointed at this server is closed. The /status endpoint just reads
// from this object so any client can reconnect and see live progress.
// ------------------------------------------------------------------
let sendState = createEmptyState();

function createEmptyState() {
    return {
        isSending: false,
        runId: null,
        total: 0,
        sent: 0,
        failed: 0,
        invalid: 0,
        currentBatchNumber: 0,
        currentBatchSize: 0,
        currentBatchProgress: 0,
        onBreak: false,
        breakEndsAt: null,      // epoch ms, so the client can render a countdown
        finished: false,
        finishedAt: null,
        summary: null,
        logs: []                 // recent log lines, newest last
    };
}

function pushLog(text) {
    const line = { time: new Date().toISOString(), text };
    console.log(`[${line.time}] ${text}`);
    sendState.logs.push(line);
    if (sendState.logs.length > 300) sendState.logs.shift(); // keep memory bounded
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Normalizes Bangladeshi numbers into the "880XXXXXXXXXX" format that
// whatsapp-web.js / WhatsApp's servers expect.
//   01700000000    -> 8801700000000
//   +8801700000000 -> 8801700000000
//   8801700000000  -> 8801700000000 (unchanged)
//   1700000000     -> 8801700000000
function formatBDNumber(raw) {
    let clean = String(raw).trim().replace(/[^0-9]/g, '');

    if (clean.startsWith('880')) {
        // already has the country code
    } else if (clean.startsWith('0')) {
        clean = '880' + clean.slice(1);
    } else if (!clean.startsWith('880')) {
        clean = '880' + clean;
    }

    return clean;
}

// ------------------------------------------------------------------
// WhatsApp Client
// ------------------------------------------------------------------
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        if (!err) qrCodeUrl = url;
    });
    console.log('QR Code generated. Scan it from the web interface.');
});

client.on('ready', () => {
    isReady = true;
    qrCodeUrl = '';
    console.log('WhatsApp Client is Ready!');
});

client.on('disconnected', (reason) => {
    isReady = false;
    console.log('WhatsApp Client disconnected:', reason);
});

client.initialize();

// ------------------------------------------------------------------
// The actual background worker. Not awaited by the route handler —
// it just runs on its own until the number list is exhausted.
// ------------------------------------------------------------------
async function processQueue(numberList, message) {
    pushLog(`🚀 Starting bulk send job: ${numberList.length} number(s) total.`);

    let remaining = [...numberList];
    let batchIndex = 0;

    while (remaining.length > 0) {
        batchIndex++;

        // Dynamic random batch size: 20–30 messages per batch
        const batchSize = Math.min(randomInt(20, 30), remaining.length);
        const batch = remaining.splice(0, batchSize);

        sendState.currentBatchNumber = batchIndex;
        sendState.currentBatchSize = batch.length;
        sendState.currentBatchProgress = 0;

        pushLog(`📦 Batch ${batchIndex} started — ${batch.length} message(s) queued.`);

        for (let i = 0; i < batch.length; i++) {
            const number = batch[i];

            try {
                // Resolve the number to a proper WhatsApp ID first —
                // this avoids the "No LID for user" style errors that
                // come from calling sendMessage on a raw number.
                const numberDetails = await client.getNumberId(number);

                if (numberDetails) {
                    await client.sendMessage(numberDetails._serialized, message);
                    sendState.sent++;
                    pushLog(`✅ Sent to ${number}`);
                } else {
                    sendState.invalid++;
                    pushLog(`⚠️  Not registered on WhatsApp: ${number}`);
                }
            } catch (err) {
                sendState.failed++;
                pushLog(`❌ Failed to send to ${number}: ${err.message || err}`);
            }

            sendState.currentBatchProgress++;

            const isLastInBatch = i === batch.length - 1;
            if (!isLastInBatch) {
                // Per-message random delay: 10–30 seconds
                const delaySec = randomInt(10, 30);
                pushLog(`⏳ Waiting ${delaySec}s before the next message...`);
                await sleep(delaySec * 1000);
            }
        }

        pushLog(`📦 Batch ${batchIndex} complete. Sent so far: ${sendState.sent}, Failed: ${sendState.failed}, Invalid: ${sendState.invalid}`);

        if (remaining.length > 0) {
            // Random long break: 10–20 minutes between batches
            const breakMin = randomInt(10, 20);
            const breakMs = breakMin * 60 * 1000;

            sendState.onBreak = true;
            sendState.breakEndsAt = Date.now() + breakMs;
            pushLog(`☕ Long break: pausing ${breakMin} minute(s) before batch ${batchIndex + 1}...`);

            await sleep(breakMs);

            sendState.onBreak = false;
            sendState.breakEndsAt = null;
        }
    }

    sendState.isSending = false;
    sendState.finished = true;
    sendState.finishedAt = new Date().toISOString();
    sendState.summary = {
        total: sendState.total,
        sent: sendState.sent,
        failed: sendState.failed,
        invalid: sendState.invalid
    };

    pushLog(`🎉 Job finished. Total: ${sendState.total} | Sent: ${sendState.sent} | Failed: ${sendState.failed} | Invalid: ${sendState.invalid}`);
}

// ------------------------------------------------------------------
// API Endpoints
// ------------------------------------------------------------------
app.get('/status', (req, res) => {
    res.json({ isReady, qrCodeUrl, sendState });
});

app.post('/send-bulk', (req, res) => {
    if (!isReady) {
        return res.status(400).json({ success: false, message: 'WhatsApp is not logged in yet.' });
    }

    if (sendState.isSending) {
        return res.status(409).json({ success: false, message: 'A sending job is already in progress. Wait for it to finish before starting a new one.' });
    }

    const { numbers, message } = req.body;

    if (!numbers || !message || !numbers.trim() || !message.trim()) {
        return res.status(400).json({ success: false, message: 'Numbers and Message are required.' });
    }

    const numberList = [...new Set(
        numbers.split(',')
            .map(n => n.trim())
            .filter(Boolean)
            .map(formatBDNumber)
    )];

    if (numberList.length === 0) {
        return res.status(400).json({ success: false, message: 'No valid numbers found.' });
    }

    // Reset job state for this new run
    sendState = createEmptyState();
    sendState.isSending = true;
    sendState.runId = Date.now();
    sendState.total = numberList.length;

    res.json({ success: true, message: `Started sending to ${numberList.length} number(s) in the background.` });

    // Fire-and-forget: this keeps running independent of any HTTP request
    processQueue(numberList, message).catch(err => {
        pushLog(`❌ Fatal error in send queue: ${err.message || err}`);
        sendState.isSending = false;
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});