const { App } = require("@slack/bolt");
const { google } = require("googleapis");
const axios = require("axios");
const store = require("./store");
const messages = require("./messages");
const helpers = require("./helpers");

// Slack Bolt app initialization
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Quip client setup
const quipClient = axios.create({
  baseURL: "https://platform.quip.com/1/",
  headers: { Authorization: `Bearer ${process.env.QUIP_ACCESS_TOKEN}` },
});

// Google Drive authentication setup
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth });

// Function to copy a file in Google Drive, removing "Copy of " prefix
async function copyFile(fileId, destinationFolderId, originalFileName) {
  const copy = await drive.files.copy({
    fileId: fileId,
    requestBody: {
      name: originalFileName,
      parents: [destinationFolderId],
    },
  });
  return copy.data.id;
}

// Recursive function to clone a folder structure in Google Drive
async function cloneFolderStructure(sourceFolderId, destinationFolderId) {
  const items = await drive.files.list({
    q: `'${sourceFolderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType)",
  });

  for (const item of items.data.files) {
    if (item.mimeType === "application/vnd.google-apps.folder") {
      const newFolder = await drive.files.create({
        resource: {
          name: item.name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [destinationFolderId],
        },
        fields: "id",
      });
      await cloneFolderStructure(item.id, newFolder.data.id);
    } else {
      await copyFile(item.id, destinationFolderId, item.name);
    }
  }
}

// Main function for Google Drive cloning
async function cloneTemplateIntoSourceDrive(
  rootFolderName,
  templateFolderName,
  destinationFolderName
) {
  try {
    const rootResponse = await drive.files.list({
      q: `name = '${rootFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
    });
    const rootFolder = rootResponse.data.files[0];
    if (!rootFolder)
      return `Root folder '${rootFolderName}' not found in Google Drive.`;

    const templateResponse = await drive.files.list({
      q: `name = '${templateFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
    });
    const templateFolder = templateResponse.data.files[0];
    if (!templateFolder)
      return `Template folder '${templateFolderName}' not found in Google Drive.`;

    const destinationCheck = await drive.files.list({
      q: `'${rootFolder.id}' in parents and name = '${destinationFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
    });

    if (destinationCheck.data.files.length > 0) {
      return `A folder named '${destinationFolderName}' already exists in '${rootFolderName}'. Creation canceled.`;
    }

    const destinationFolder = await drive.files.create({
      resource: {
        name: destinationFolderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootFolder.id],
      },
      fields: "id",
    });

    await cloneFolderStructure(templateFolder.id, destinationFolder.data.id);

    return `Google Drive folder structure cloned! Here is your link: https://drive.google.com/drive/folders/${destinationFolder.data.id}`;
  } catch (error) {
    console.error("Error cloning Google Drive folder structure:", error);
  }
}

// Quip function to clone folder structure
async function cloneTemplateInQuip(
  templateFolderName,
  destinationFolderName,
  rootFolderName
) {
  async function checkIfFolderExists(folderName) {
    const response = await quipClient.get("/threads");
    return response.data.find((f) => f.title === folderName) || null;
  }

  async function createQuipFolder(title, parentId = null) {
    const response = await quipClient.post("/folders/new", {
      title: title,
      parent_id: parentId,
    });
    return response.data;
  }

  async function copyQuipDocument(docId, destinationFolderId) {
    await quipClient.post(`/threads/copy`, {
      thread_id: docId,
      destination_folder_id: destinationFolderId,
    });
  }

  async function cloneQuipFolderStructure(
    templateFolderId,
    destinationFolderId
  ) {
    const response = await quipClient.get(
      `/folders/${templateFolderId}/children`
    );
    const items = response.data.children;

    for (const item of items) {
      if (item.thread_id) {
        await copyQuipDocument(item.thread_id, destinationFolderId);
      } else if (item.folder_id) {
        const newFolder = await createQuipFolder(
          item.title,
          destinationFolderId
        );
        await cloneQuipFolderStructure(item.folder_id, newFolder.id);
      }
    }
  }

  try {
    const rootFolder = await checkIfFolderExists(rootFolderName);
    if (!rootFolder)
      return `Root folder '${rootFolderName}' not found in Quip.`;

    const templateFolder = await checkIfFolderExists(templateFolderName);
    if (!templateFolder)
      return `Template folder '${templateFolderName}' not found in Quip.`;

    const existingDestinationFolder = await checkIfFolderExists(
      destinationFolderName
    );
    if (existingDestinationFolder) {
      return `A folder named '${destinationFolderName}' already exists in Quip. Creation canceled.`;
    }

    const destinationFolder = await createQuipFolder(
      destinationFolderName,
      rootFolder.id
    );
    await cloneQuipFolderStructure(templateFolder.id, destinationFolder.id);

    return `Quip folder structure cloned!`;
  } catch (error) {
    console.error("Error cloning Quip folder structure:", error);
  }
}

// Slack event to trigger cloning in both Google Drive and Quip
app.event("app_mention", async ({ event, say }) => {
  const [rootFolderName, templateFolderName, destinationFolderName] = event.text
    .split(" ")
    .slice(1);

  if (!rootFolderName || !templateFolderName || !destinationFolderName) {
    await say(
      "Please specify the root, template, and destination folder names."
    );
    return;
  }

  try {
    const driveResultMessage = await cloneTemplateIntoSourceDrive(
      rootFolderName,
      templateFolderName,
      destinationFolderName
    );
    const quipResultMessage = await cloneTemplateInQuip(
      templateFolderName,
      destinationFolderName,
      rootFolderName
    );

    await say(`${driveResultMessage}\n${quipResultMessage}`);
  } catch (error) {
    console.error("Error in event handling:", error);
    await say("Sorry, I couldn't clone the folder structure.");
  }
});

// Start Bolt app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Bolt app is running!");
})();
