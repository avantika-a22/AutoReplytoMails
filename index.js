const fs = require('fs').promises;  //File system module for handling file operations.
const path = require('path');   //Module for working with file and directory paths.
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth'); //Library for authenticating Google API requests locally.
const { google } = require('googleapis');   // API
let client = '';
var cron = require('node-cron');   // allow you to run code at specific intervals.


// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
    client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listLabels(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.labels.list({
        userId: 'me',
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
        console.log('No labels found.');
        return;
    }
    console.log('Labels:');
    labels.forEach((label) => {
        console.log(`- ${label.name}`);
    });
}


// List messages
async function listMessages(auth, query) {
    return new Promise((resolve, reject) => {
        const gmail = google.gmail({ version: 'v1', auth });
        gmail.users.messages.list(
            {
                userId: 'me',
                q: query,
                maxResults: 10
            },
            (err, res) => {
                console.log(res)
                if (err) {
                    reject(err);
                    return;
                }
                if (!res.data.messages) {
                    console.log("bdj")
                    resolve([]);
                    return;
                }
                
                // Loop through messages and reply
                res.data.messages.map(async (item, index) => {
                        console.log(item)
                        await replyToEmail(item.id, "Hii there", auth)
                })
            }
        );
    })
        ;
}



// Reply to message
async function replyToEmail(messageId, messageText, auth) {
    try {
        const gmail = google.gmail({ version: 'v1', auth });
        const message = await gmail.users.messages.get({ userId: 'me', id: messageId });

        if (message && message.data) {
            const headers = message.data.payload.headers;
            let toAddress = '';
            let subject = '';

            for (const header of headers) {
                if (header.name === 'From') {
                    toAddress = header.value;
                    console.log(toAddress)
                } else if (header.name === 'Subject') {
                    subject = header.value;
                }
            }

            const emailLines = [];
            emailLines.push(`From: ${toAddress}`);
            emailLines.push(`To: ${toAddress}`);
            emailLines.push(`In-Reply-To: ${messageId}`);
            emailLines.push(`References: ${messageId}`);
            emailLines.push(`Subject: Re: ${subject}`);
            emailLines.push('');
            emailLines.push(messageText);

            const email = emailLines.join('\r\n').trim();
            const base64EncodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

            await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: base64EncodedEmail,
                },
            });

            // Mark the sent message as read
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['UNREAD']
                }
            });

            console.log('Reply sent successfully.');
        } else {
            console.log('No message found with the given ID.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}


// Cron job 
// Run every 90 seconds
cron.schedule("*/90 * * * * *", () => {
    console.log('running a task every 90 seconds');
    authorize().then(listLabels).then(() => {
        listMessages(client, 'is:unread category:primary')
    }).catch(console.error);
});
