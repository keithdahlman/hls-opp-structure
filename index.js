const { App } = require('@slack/bolt')
const { google } = require('googleapis');
const axios = require('axios');
const store = require('./store')
const messages = require('./messages')
const helpers = require('./helpers')

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Google Drive setup
const drive = google.drive({
  version: 'v3',
  auth: new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/drive']
  })
});

// Function to create folder in Google Drive
async function createDriveFolder(accountName) {
  try {
    const folderMetadata = {
      name: accountName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    const driveResponse = await drive.files.create({
      resource: folderMetadata,
      fields: 'id'
    });
    return driveResponse.data.id;
  } catch (error) {
    console.error("Error creating Google Drive folder:", error);
  }
}

// Function to create Quip document
async function createQuipDocument(accountName) {
  try {
    const response = await axios.post(
      'https://platform.quip.com/1/threads/new-document',
      {
        title: `${accountName} - Project Notes`,
        content: "### Document template for project information and updates."
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.QUIP_ACCESS_TOKEN}`
        }
      }
    );
    return response.data.thread.id;
  } catch (error) {
    console.error("Error creating Quip document:", error);
  }
}

// Slack command or event listener
app.event('app_mention', async ({ event, client, say }) => {
  const accountName = event.text.split(' ')[1]; // Extract account name from message

  try {
    // Create folders in Google Drive and Quip
    const driveFolderId = await createDriveFolder(accountName);
    const quipDocId = await createQuipDocument(accountName);

    // Send response to Slack
    await say(`Folders created! Google Drive: https://drive.google.com/drive/folders/${driveFolderId}, Quip: https://quip.com/${quipDocId}`);
  } catch (error) {
    console.error("Error in event handling:", error);
    await say("Sorry, I couldn't complete the folder setup.");
  }
});

// Start app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();