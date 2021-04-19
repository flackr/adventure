const http = require('http');
const WebSocketServer = require('ws').Server;
const finalhandler = require('finalhandler');
const serveStatic = require('serve-static');

function splitWords(text, words) {
  let prev = 0;
  let cur = 0;
  let result = [];
  while (cur < text.length && result.length < words - 1) {
    if (text[cur] == ' ') {
      result.push(text.substring(prev, cur));
      prev = cur + 1;
    }
    ++cur;
  }
  result.push(text.substring(prev));
  return result;
}

function englishList(list) {
  if (list.length == 0)
    return '';
  if (list.length == 1)
    return list[0];
  return list.slice(0, list.length - 1).join(', ') + ' and ' + list[list.length - 1];
}

const directions = {
  "north": "north",
  "n": "north",
  "south": "south",
  "s": "south",
  "east": "east",
  "e": "east",
  "west": "west",
  "w": "west",
  "up": "up",
  "u": "up",
  "down": "down",
  "d": "down",
  "in": "in",
  "i": "in",
  "out": "out",
  "o": "out",
}

class Server {
  constructor() {
    this._webServer = null;
    this._webSocketServer = null;
    this._serveStatic = serveStatic('static/');
    this._clients = {};
    this._playerNo = 0;
    this._world = {
      "rooms": {
        "Entry": {
          "desc": "A plain looking entryway. To the south lies the living room.",
          "exits": {
            "south": "Living room",
          }
        },
        "Living room": {
          "desc": "A large room with a TV in the corner. To the north you can see the entry.",
          "exits": {
            "north": "Entry",
          }
        }
      },
      "players": {},
    };
  }

  playersIn(room, exclude) {
    // TODO: Maybe optimize this?
    let result = [];
    for (let player in this._world.players) {
      if (player == exclude)
        continue;
      if (this._world.players[player].room == room)
        result.push(player);
    }
    return result;
  }

  listen() {
    this._webServer = http.createServer(this.onRequest);
    const port = process.env.PORT;
    this._webSocketServer = new WebSocketServer({'server': this._webServer});
    this._webSocketServer.on('connection', this.onConnection);
    this._webServer.listen(port);
    console.log('Listening on ' + port);
  }

  broadcast(room, user, message) {
    console.log('Broadcast to ' + room + ' message ' + message);
    for (let i in this._clients) {
      if (!room || this._world.players[i].room == room)
        this._clients[i].send(JSON.stringify({type: 'message', content: message}));
    }
  }

  sendDirect(user, message) {
    console.log('Sent to ' + user + ', ' + message);
    this._clients[user].send(JSON.stringify({type: 'message', content: message}));
  }

  look(name, target) {
    // TODO: Support looking at other targets.
    let room = this._world.players[name].room;
    let desc = this._world.rooms[room].desc;
    this.sendDirect(name, `<h3>${room}</h3>
    <p>${desc}</p>`);
    let players = englishList(this.playersIn(room, name));    
    if (players) {
      this.sendDirect(name, `<p>You see ${players}.</p>`);
    }
  }

  enter(name, room) {
    this.broadcast(room, name, `<p>${name} enters the room.</p>`);
    this._world.players[name].room = room;
    this.sendDirect(name, `<p>You have entered the ${room}</p>`);
    this.look(name);
  }

  addPlayer(name, websocket) {
    const entryRoom = 'Entry';
    this._world.players[name] = {
      room: '',
    };
    this._clients[name] = websocket;
    this.enter(name, entryRoom);
  }

  renamePlayer(oldName, newName) {
    if (oldName == newName) {
      this.sendDirect(oldName, "<p>That's already your name.</p>");
      return false;
    }
    if (this._clients[newName]) {
      this.sendDirect(oldName, "<p>There's already a player with that name.</p>");
      return false;
    }
    this._world.players[newName] = this._world.players[oldName];
    this._clients[newName] = this._clients[oldName];
    delete this._clients[oldName];
    delete this._world.players[oldName];
    this.broadcast(this._world.players[newName].room, newName, `<p>${oldName} changed their name to ${newName}</p>`);
    return true;
  }

  removePlayer(player) {
    const room = this._world.players[player].room;
    delete this._clients[player];
    delete this._world.players[player];
    this.broadcast(room, player, `<p>${player} left the room.</p>`);
  }

  move(player, direction) {
    let oldRoom = this._world.players[player].room;
    let newRoom = this._world.rooms[oldRoom].exits[direction];
    if (!newRoom) {
      let exits = [];
      for (let exit in this._world.rooms[oldRoom].exits)
        exits.push(exit);
      this.sendDirect(player, "Unable to go " + direction + ". Valid exits are " + exits.join(', ') + ".");
      return;
    }
    this._world.players[player].room = null;
    this.broadcast(oldRoom, player, `<p>${player} leaves to the ${direction}.</p>`);
    // TODO: Announce from which direction the player enters.
    this.enter(player, newRoom);
  }

  showHelp(name, subtopic) {
    this.sendDirect(name, `<h3>Help</h3>
    <p>These are the basic commands:</p>
    <p>say [text] Says the given text in the room you are in. You can also just write "text</p>
    <p>name [new name] Changes your name.</p>
    <p>[direction] Moves in that direction. Look at the room description for valid exits.</p>`);
  }

  onRequest = (req, res) => {
    console.log('Request for ' + req.url);
    const done = finalhandler(req, res);
    this._serveStatic(req, res, done);
  };

  onConnection = (websocket, req) => {
    let name = 'Guest' + (++this._playerNo);
    this._world.players[name] = {"room": "Entry"};
    console.log('Websocket connection');
    this.addPlayer(name, websocket);
    const pingInterval = setInterval(() => {
      websocket.send(JSON.stringify({type: 'ping'}));
    }, 5000);

    let process = (command) => {
      let action = splitWords(command, 2);

      // " or say [message]
      if (command.startsWith('"') || action[0] == 'say') {
        let message = command[0] == '"' ? command.substring(1) : action[1];
        this.broadcast(this._world.players[name].room, name, `<p>${name} says ${message}</p>`);
        return;
      }
      
      if (action[0] == 'name') {
        if (this.renamePlayer(name, action[1]))
          name = action[1];
        return;
      }

      if (action[0] == 'help') {
        this.showHelp(name, action[1]);
        return;
      }

      let direction = null;
      if (command in directions) {
        direction = directions[command];
      } else if (action[0] == 'go') {
        direction = directions[action[1]] || action[1];
      }
      if (direction)
        this.move(name, direction);
    };

    websocket.on('message', (message) => {
      let data = null;
      try {
        data = JSON.parse(message);
      } catch (e) {}
      if (!data)
        return;
      if (data.type == 'message') {
        process(data.content);
      }
  });

    websocket.on('close', () => {
      clearInterval(pingInterval);
      this.removePlayer(name);
    });
  };
}

(new Server()).listen();
