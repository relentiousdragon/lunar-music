const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'logs');
const ERROR_LOG = path.join(LOGS_DIR, 'error.log');

const MAX_RESTARTS_PER_HOUR = 10;
const RESTART_WINDOW_MS = 3600000; // 1h

const restartTimestamps = [];
//
function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

function writeErrorLog(message) {
    ensureLogsDir();
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(ERROR_LOG, logEntry, 'utf8');
    } catch (err) {
        console.error(`[supervisor] failed to write to log file: ${err.message}`);
    }
}

let child = null;
let isIntentionalShutdown = false;

function startBot() {
    console.log('[supervisor] starting lunar-music (src/index.js)...');

    child = fork(path.join(__dirname, 'src', 'index.js'), [], {
        stdio: ['inherit', 'inherit', 'pipe', 'ipc']
    });

    let errorBuffer = '';

    if (child.stderr) {
        child.stderr.on('data', (chunk) => {
            const str = chunk.toString();
            process.stderr.write(chunk);
            errorBuffer += str;

            if (errorBuffer.length > 50000) {
                errorBuffer = errorBuffer.slice(-25000);
            }
        });
    }

    child.on('error', (err) => {
        console.error(`[supervisor] child process error: ${err.message}`);
        writeErrorLog(`CHILD PROCESS ERROR: ${err.stack || err.message}`);
    });

    child.on('exit', (code, signal) => {
        console.log(`[supervisor] child process exited with code ${code} (signal: ${signal || 'none'})`);

        if (errorBuffer.trim()) {
            writeErrorLog(`STDERR OUTPUT BEFORE EXIT:\n${errorBuffer.trim()}`);
        }

        if (isIntentionalShutdown) {
            console.log('[supervisor] intentional shutdown requested. exiting supervisor.');
            process.exit(0);
        }

        const now = Date.now();
        restartTimestamps.push(now);

        while (restartTimestamps.length > 0 && now - restartTimestamps[0] > RESTART_WINDOW_MS) {
            restartTimestamps.shift();
        }

        if (restartTimestamps.length > MAX_RESTARTS_PER_HOUR) {
            const msg = `CRITICAL: max restarts per hour limit reached (${MAX_RESTARTS_PER_HOUR}/${RESTART_WINDOW_MS / 1000}s). Stopping supervisor.`;
            console.error(`[supervisor] ${msg}`);
            writeErrorLog(msg);
            process.exit(1);
        }

        console.log(`[supervisor] restarting bot in 1.5 seconds... (restart ${restartTimestamps.length}/${MAX_RESTARTS_PER_HOUR} in past hour)`);
        setTimeout(() => {
            startBot();
        }, 1500);
    });
}

function shutdown(signal) {
    console.log(`\n[supervisor] received ${signal}, stopping child process...`);
    isIntentionalShutdown = true;
    if (child) {
        child.kill(signal);
    }
    process.exit(0);
}
//
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
startBot();
// contributors: @relentiousdragon