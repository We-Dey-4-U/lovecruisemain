const http = require("http");

const app = express();

const server = http.createServer(app);

require("./socket")(server);

server.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});