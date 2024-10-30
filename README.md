# Slack Bolt App

### Features

* Respond to app_mention and takes params to duplicate templated folders in a new opportunity folder in both quip and gdrive

### Requirements

* A Bot User must be added to your App
* Your App must be subscribed to [Events API](https://api.slack.com/events-api)
* [Interactive components](https://api.slack.com/reference/messaging/interactive-components) must be enabled
* Your app needs to be subscribed to the events mentioned in the *Events* section

### Scopes

* [`bot`](https://api.slack.com/scopes/bot)
* [`channels:write`](https://api.slack.com/scopes/channels:write)

### Events

#### Workspace events
* [`app_home_opened`](https://api.slack.com/events/app_home_opened)

#### Bot events
* [`member_joined_channel`](https://api.slack.com/events/member_joined_channel)
* [`reaction_added`](https://api.slack.com/events/reaction_added)