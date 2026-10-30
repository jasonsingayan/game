# Phrase Rush

A host-led, live phrase guessing game. The host creates a room and shares its link; players join with a name and guess from their own devices.

## Run it locally

Install Node.js 18 or newer, then from this folder run:

```sh
npm start
```

Open <http://localhost:3000>. Select **Create a game room**, copy the room link, and share it. For players on the same Wi-Fi, open the app from the host computer's local network address (for example, `http://192.168.1.20:3000`) before copying the link. `localhost` only works on the computer running the app.

## Share it over the internet

This project includes a Render Blueprint in `render.yaml`. Put the project in a Git repository, connect that repository to Render, and deploy the Blueprint. Once Render gives the app a public URL, open it, create a room, and share the invite link it generates. Keep the service running for the full game.

The room is held in the running server's memory. It supports one live server process; restarting the service ends any active room.

## How a game works

- The host starts each of 20 familiar phrases and controls each reveal with **Reveal next letter**.
- Every phrase has four to six words. The clock starts at 60 seconds, and the phrase closes when time runs out, all letters are revealed, or three players guess correctly.
- The first three correct guesses for each phrase earn 100, 70, and 50 points. Answers are checked without regard to capitalization or punctuation.
- After phrase 20, the final screen shows the top three players and the full scoreboard.
- Quiet, original ambient music is generated in the browser. The host can turn it on or off for the room; each player can mute it for their own device.
