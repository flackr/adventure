document.addEventListener('DOMContentLoaded', init);

function init() {
  let input = document.querySelector('input');
  let scroller = document.querySelector('.scroller');
  let content = document.querySelector('.content');
  let socket = new WebSocket(location.origin.replace(/^http/, 'ws') + location.pathname + 'game');
  scroller.scrollTop = scroller.scrollHeight;
  socket.addEventListener('message', onMessage);
  input.addEventListener('keypress', onKeyPress);

  function addContent(data) {
    content.innerHTML += data;
  }

  socket.addEventListener('open', () => {
    addContent('<p>Connected</p>');
  });
  socket.addEventListener('close', () => {
    addContent('<p>Disconnected</p>');
  });

  function onMessage(evt) {
    let data = null;
    try {
      data = JSON.parse(evt.data);
    } catch(e) {}
    if (data.type == 'message') {
      addContent(data.content);
    } else if (data.type == 'ping') {
      socket.send(JSON.stringify({type: 'ping'}));
    }
  }

  function onKeyPress(evt) {
    if (evt.keyCode != 13)
      return;

    socket.send(JSON.stringify({type: 'message', content: input.value}));
    input.value = '';
  }
}
