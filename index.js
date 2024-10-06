#!/usr/bin/env bun
import { google } from 'googleapis';
import clipboardy from 'clipboardy';
import open from 'open';
import fs from 'fs';
import path from 'path';
import http from 'http';
import assert from 'assert';
import { execSync } from 'child_process';
import data from "./package.json";

// Define the help message
const helpMessage = `
Usage: clip2drive [options]

Options:
  -v, --version      Show the current version.
  -h, --help         Show help information.
  --auth-only        Perform authentication only.
`;

// Check for the --help or -h flag to display help information
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(helpMessage);
    process.exit(0);
}

// Print current version if the user requests it, by passing the --version or -v flag
if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log(data.version);
    process.exit(0);
}

// If only authentication is requested, add the --auth-only flag
const ONLY_AUTH = process.argv.includes('--auth-only');

// Credentials are injected directly during the build process
const ENCODED_CLIENT_ID = '__ENCODED_CLIENT_ID__';
const ENCODED_CLIENT_SECRET = '__ENCODED_CLIENT_SECRET__';
const ENCODED_FOLDER_ID = '__ENCODED_FOLDER_ID__';

// If user passed environment variables, use them. Otherwise, use the default values and decode the base64-encoded credentials
const CLIENT_ID = process.env.CLIENT_ID || Buffer.from(ENCODED_CLIENT_ID, 'base64').toString('utf8');
const CLIENT_SECRET = process.env.CLIENT_SECRET || Buffer.from(ENCODED_CLIENT_SECRET, 'base64').toString('utf8');
const FOLDER_ID = process.env.FOLDER_ID || Buffer.from(ENCODED_FOLDER_ID, 'base64').toString('utf8');

// Adjust TOKEN_PATH to a known location
const os = require('os');
const TOKEN_PATH = path.join(os.homedir(), '.clip2drive_token.json');

const getDate = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0'); // Months start at 0!
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const mmm = String(now.getMilliseconds()).padStart(3, '0');
    return { yyyy, mm, dd, hh, min, ss, mmm };
};

// Function to get current timestamp in [yyyy-mm-dd hh:mm:ss.MMM] format
const getTimestamp = () => {
    const { yyyy, mm, dd, hh, min, ss, mmm } = getDate();
    return `[${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${mmm}]`;
};

// Custom logging functions
const log = (message) => {
    console.log(`${getTimestamp()} ${message}`);
};

const errorLog = (message) => {
    console.error(`${getTimestamp()} ${message}`);
};

try {
    assert(CLIENT_ID, 'CLIENT_ID is not set.');
    assert(CLIENT_SECRET, 'CLIENT_SECRET is not set.');
    assert(FOLDER_ID, 'FOLDER_ID is not set.');
} catch (err) {
    errorLog(err.message);
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    'http://localhost:3000'
);

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const authenticate = async () => {
    try {
        log(`Attempting to read token from ${TOKEN_PATH}`);
        const token = fs.readFileSync(TOKEN_PATH);
        oauth2Client.setCredentials(JSON.parse(token));
        log('Token loaded successfully.');
    } catch {
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });

        log('Opening the browser for authentication...');
        await open(authUrl);

        const code = await new Promise((resolve, reject) => {
            const server = http
                .createServer((req, res) => {
                    const qs = new URL(req.url, 'http://localhost:3000').searchParams;
                    const code = qs.get('code');
                    try {
                        assert(code, 'Authentication code not found in the callback URL.');
                        res.end('Authentication successful! You can close this window.');
                        server.close();
                        resolve(code);
                    } catch (error) {
                        res.end('Authentication failed.');
                        server.close();
                        reject(error);
                    }
                })
                .listen(3000, () => log('Waiting for authentication...'));
        });

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        log(`Token stored to ${TOKEN_PATH}`);
    }

    if (ONLY_AUTH) {
        log('Only authentication requested...');
        process.exit(0);
    }
};

const modifyClipboardContent = (content) => {
    // Remove tabs and replace them with 2 spaces
    // Replace • to - for better Markdown formatting
    return content.replace(/\t/g, '  ').replace(/•/g, '-');
};

const generateFileName = (content) => {
    try {
        // Generate a better name using ollama
        const prompt = `Provide a short (max 30 characters) descriptive name for the following content as file name (only one option, as one string):\n${content}`;
        const requestData = JSON.stringify({
            model: 'llama3.2',
            prompt: prompt,
            "stream": false
        });

        log("Sending request to Ollama to generate a file name...");

        const curlCommand = `curl -s http://localhost:11434/api/generate -H "Content-Type: application/json" -d '${requestData}'`;
        const response = execSync(curlCommand, { encoding: 'utf8' });
        const parsedResponse = JSON.parse(response);

        if (parsedResponse.response) {
            const generatedName = parsedResponse.response.trim().replace(/\s+/g, '-').replace(/"/g, '');
            log(`Generated name: ${generatedName}`);
            return generatedName;
        }
        throw new Error("Failed to get a valid response from Ollama.");
    } catch (error) {
        log("llama3.2 not found or failed to generate a name. Using default name.");
        log(`generateFileName error: ${error}`);
        return "Note";
    }
};

const uploadFile = async () => {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const content = clipboardy.readSync();

    try {
        assert(content, 'Clipboard is empty. Please copy some text to upload.');
        log('Clipboard content retrieved successfully.');
    } catch (error) {
        errorLog(error.message);
        process.exit(1);
    }

    // Modify the content before uploading
    const modifiedContent = modifyClipboardContent(content);

    try {
        assert(modifiedContent, 'Failed to modify clipboard content.');
        log('Clipboard content modified successfully.');
    } catch (error) {
        errorLog(error.message);
        process.exit(1);
    }

    // Generate a name for the file
    const generatedName = generateFileName(modifiedContent);

    // Generate date and time in YYYY-MM-DD-HH-MM-SS-MMM format
    const { yyyy, mm, dd, hh, min, ss, mmm } = getDate();
    const dateTimeString = `${yyyy}-${mm}-${dd}-${hh}-${min}-${ss}-${mmm}`;

    // Set the file name to include both the timestamp and generated name
    const fileMetadata = {
        name: `${generatedName}-${dateTimeString}.md`,
        parents: [FOLDER_ID],
    };
    const media = {
        mimeType: 'text/markdown',
        body: modifiedContent,
    };

    try {
        log('Uploading file to Google Drive...');
        const { data } = await drive.files.create({
            resource: fileMetadata,
            media,
            fields: 'id, webViewLink',
        });

        assert(data.id, 'Failed to upload file to Google Drive.');
        log('File uploaded successfully.');

        await drive.permissions.create({
            fileId: data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });
        log('Permissions set to "Anyone with the link can view".');

        assert(data.webViewLink, 'Failed to retrieve webViewLink for the uploaded file.');
        clipboardy.writeSync(data.webViewLink);
        log(`Link copied to clipboard: ${data.webViewLink}`);
    } catch (error) {
        errorLog(`Error during file upload: ${error.message}`);
    }
};

(async () => {
    try {
        await authenticate();
        await uploadFile();
    } catch (error) {
        errorLog(`Error: ${error.message}`);
    }
})();