const { App } = require("@slack/bolt");
const { google } = require("googleapis");
const axios = require("axios");
const store = require("./store");
const messages = require("./messages");
const helpers = require("./helpers");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth });

// Function to copy a file and remove "Copy of " from the file name
async function copyFile(fileId, destinationFolderId, originalFileName) {
  const copy = await drive.files.copy({
    fileId: fileId,
    requestBody: {
      name: originalFileName, // Set the original name to avoid "Copy of "
      parents: [destinationFolderId]
    }
  });
  return copy.data.id;
}

// Recursive function to clone a folder structure, including all files and subfolders
async function cloneFolderStructure(sourceFolderId, destinationFolderId) {
  const items = await drive.files.list({
    q: `'${sourceFolderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)'
  });

  for (const item of items.data.files) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      // If item is a folder, create a corresponding folder in the destination
      const newFolder = await drive.files.create({
        resource: {
          name: item.name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [destinationFolderId]
        },
        fields: 'id'
      });

      // Recursively copy the contents of the folder
      await cloneFolderStructure(item.id, newFolder.data.id);
    } else {
      // If item is a file, copy it to the destination folder with original name
      await copyFile(item.id, destinationFolderId, item.name);
    }
  }
}

// Main function to initiate the cloning process
async function cloneTemplateIntoSource(sourceFolderName, templateFolderName, destinationFolderName) {
  try {
    // Locate the source folder
    const sourceResponse = await drive.files.list({
      q: `name = '${sourceFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)'
    });
    const sourceFolder = sourceResponse.data.files[0];
    if (!sourceFolder) return `Source folder '${sourceFolderName}' not found.`;

    // Locate the template folder
    const templateResponse = await drive.files.list({
      q: `name = '${templateFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)'
    });
    const templateFolder = templateResponse.data.files[0];
    if (!templateFolder) return `Template folder '${templateFolderName}' not found.`;

    // Check if the destination folder already exists within the source folder
    const destinationCheck = await drive.files.list({
      q: `'${sourceFolder.id}' in parents and name = '${destinationFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)'
    });

    if (destinationCheck.data.files.length > 0) {
      // If a folder with the same name already exists, cancel creation
      return `A folder named '${destinationFolderName}' already exists in '${sourceFolderName}'. Creation canceled.`;
    }

    // Create the destination folder within the source folder
    const destinationFolder = await drive.files.create({
      resource: {
        name: destinationFolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [sourceFolder.id]
      },
      fields: 'id'
    });

    // Clone the template folder structure into the newly created destination folder
    await cloneFolderStructure(templateFolder.id, destinationFolder.data.id);

    return `Folder structure cloned! Here is your link: https://drive.google.com/drive/folders/${destinationFolder.data.id}`;
  } catch (error) {
    console.error("Error cloning folder structure:", error);
  }
}


// Slack event to trigger folder cloning
app.event("app_mention", async ({ event, say }) => {
  const [sourceFolderName, templateFolderName, destinationFolderName] =
    event.text.split(" ").slice(1);

  if (!sourceFolderName || !templateFolderName || !destinationFolderName) {
    await say(
      "Please specify the source, template, and destination folder names."
    );
    return;
  }

  try {
    const resultMessage = await cloneTemplateIntoSource(
      sourceFolderName,
      templateFolderName,
      destinationFolderName
    );
    await say(resultMessage);
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
