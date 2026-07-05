const iceServers = [
  {
    urls: [
      "stun:stun.l.google.com:19302"
    ]
  }
];

if (
  process.env.TURN_URL &&
  process.env.TURN_USERNAME &&
  process.env.TURN_PASSWORD
) {

  iceServers.push({
    urls:
      process.env.TURN_URL,

    username:
      process.env.TURN_USERNAME,

    credential:
      process.env.TURN_PASSWORD
  });

}

module.exports = {
  iceServers
};