const crypto = require("crypto");
SHA256 = (message) => crypto.createHash("sha256").update(message).digest("hex");
const EC = require("elliptic").ec,
  ec = new EC("secp256k1");
const { Block, Blockchain, Transaction, Ycoin } = require("./blockchain");

const MINT_PRIVATE_ADDRESS =
  "0700a1ad28a20e5b2a517c00242d3e25a88d84bf54dce9e1733e6096e6d6495e";
const MINT_KEY_PAIR = ec.keyFromPrivate(MINT_PRIVATE_ADDRESS, "hex");
const MINT_PUBLIC_ADDRESS = MINT_KEY_PAIR.getPublic("hex");

const privateKey =
  "39a4a81e8e631a0c51716134328ed944501589b447f1543d9279bacc7f3e3de7";
const keyPair = ec.keyFromPrivate(privateKey, "hex");
const publicKey = keyPair.getPublic("hex");

const WS = require("ws");

const PORT = 3001;
const PEERS = ["ws://localhost:3000"];
const MY_ADDRESS = "ws://localhost:3001";
const server = new WS.Server({ port: PORT });

let opened = [],
  connected = [];
let check = [];
let checked = [];
let checking = false;
let tempChain = new Blockchain();

console.log("Listening on PORT", PORT);

server.on("connection", async (socket, req) => {
  socket.on("message", (message) => {
    const _message = JSON.parse(message);

    console.log(_message);

    switch (_message.type) {
      case "TYPE_REPLACE_CHAIN":
        const [newBlock, newDiff] = _message.data;

        const ourTx = [...Ycoin.transactions.map((tx) => JSON.stringify(tx))];
        const theirTx = [
          ...newBlock.data
            .filter((tx) => tx.from !== MINT_PUBLIC_ADDRESS)
            .map((tx) => JSON.stringify(tx)),
        ];
        const n = theirTx.length;

        if (newBlock.prevHash !== Ycoin.getLastBlock().prevHash) {
          for (let i = 0; i < n; i++) {
            const index = ourTx.indexOf(theirTx[0]);

            if (index === -1) break;

            ourTx.splice(index, 1);
            theirTx.splice(0, 1);
          }

          if (
            theirTx.length === 0 &&
            SHA256(
              Ycoin.getLastBlock().hash +
                newBlock.timestamp +
                JSON.stringify(newBlock.data) +
                newBlock.nonce
            ) === newBlock.hash &&
            newBlock.hash.startsWith(
              "000" +
                Array(
                  Math.round(Math.log(Ycoin.difficulty) / Math.log(16) + 1)
                ).join("0")
            ) &&
            Block.hasValidTransactions(newBlock, Ycoin) &&
            (parseInt(newBlock.timestamp) >
              parseInt(Ycoin.getLastBlock().timestamp) ||
              Ycoin.getLastBlock().timestamp === "") &&
            parseInt(newBlock.timestamp) < Date.now() &&
            Ycoin.getLastBlock().hash === newBlock.prevHash &&
            (newDiff + 1 === Ycoin.difficulty ||
              newDiff - 1 === Ycoin.difficulty)
          ) {
            Ycoin.chain.push(newBlock);
            Ycoin.difficulty = newDiff;
            Ycoin.transactions = [...ourTx.map((tx) => JSON.parse(tx))];
          }
        } else if (
          !checked.includes(
            JSON.stringify([
              newBlock.prevHash,
              Ycoin.chain[Ycoin.chain.length - 2].timestamp || "",
            ])
          )
        ) {
          checked.push(
            JSON.stringify([
              Ycoin.getLastBlock().prevHash,
              Ycoin.chain[Ycoin.chain.length - 2].timestamp || "",
            ])
          );

          const position = Ycoin.chain.length - 1;

          checking = true;

          sendMessage(produceMessage("TYPE_REQUEST_CHECK", MY_ADDRESS));

          setTimeout(() => {
            checking = false;

            let mostAppeared = check[0];

            check.forEach((group) => {
              if (
                check.filter((_group) => _group === group).length >
                check.filter((_group) => _group === mostAppeared).length
              ) {
                mostAppeared = group;
              }
            });

            const group = JSON.parse(mostAppeared);

            Ycoin.chain[position] = group[0];
            Ycoin.transactions = [...group[1]];
            Ycoin.difficulty = group[2];

            check.splice(0, check.length);
          }, 5000);
        }

        break;

      case "TYPE_REQUEST_CHECK":
        opened
          .filter((node) => node.address === _message.data)[0]
          .socket.send(
            JSON.stringify(
              produceMessage(
                "TYPE_SEND_CHECK",
                JSON.stringify([
                  Ycoin.getLastBlock(),
                  Ycoin.transactions,
                  Ycoin.difficulty,
                ])
              )
            )
          );

        break;

      case "TYPE_SEND_CHECK":
        if (checking) check.push(_message.data);

        break;

      case "TYPE_CREATE_TRANSACTION":
        const transaction = _message.data;

        Ycoin.addTransaction(transaction);

        break;

      case "TYPE_SEND_CHAIN":
        const { block, finished } = _message.data;

        if (!finished) {
          tempChain.chain.push(block);
        } else {
          tempChain.chain.push(block);
          if (Blockchain.isValid(tempChain)) {
            Ycoin.chain = tempChain.chain;
          }
          tempChain = new Blockchain();
        }

        break;

      case "TYPE_REQUEST_CHAIN":
        const socket = opened.filter(
          (node) => node.address === _message.data
        )[0].socket;
        console.log("chain requested");
        for (let i = 1; i < Ycoin.chain.length; i++) {
          socket.send(
            JSON.stringify(
              produceMessage("TYPE_SEND_CHAIN", {
                block: Ycoin.chain[i],
                finished: i === Ycoin.chain.length - 1,
              })
            )
          );
        }

        break;

      case "TYPE_REQUEST_INFO":
        opened
          .filter((node) => node.address === _message.data)[0]
          .socket.send(
            JSON.stringify(
              produceMessage("TYPE_SEND_INFO", [
                Ycoin.difficulty,
                Ycoin.transactions,
              ])
            )
          );

        break;

      case "TYPE_SEND_INFO":
        [Ycoin.difficulty, Ycoin.transactions] = _message.data;

        break;

      case "TYPE_HANDSHAKE":
        const nodes = _message.data;

        nodes.forEach((node) => connect(node));
    }
  });
});

async function connect(address) {
  if (
    !connected.find((peerAddress) => peerAddress === address) &&
    address !== MY_ADDRESS
  ) {
    const socket = new WS(address);

    socket.on("open", () => {
      socket.send(
        JSON.stringify(
          produceMessage("TYPE_HANDSHAKE", [MY_ADDRESS, ...connected])
        )
      );

      opened.forEach((node) =>
        node.socket.send(
          JSON.stringify(produceMessage("TYPE_HANDSHAKE", [address]))
        )
      );

      if (
        !opened.find((peer) => peer.address === address) &&
        address !== MY_ADDRESS
      ) {
        opened.push({ socket, address });
      }

      if (
        !connected.find((peerAddress) => peerAddress === address) &&
        address !== MY_ADDRESS
      ) {
        connected.push(address);
      }
    });

    socket.on("close", () => {
      opened.splice(connected.indexOf(address), 1);
      connected.splice(connected.indexOf(address), 1);
    });
  }
}

function produceMessage(type, data) {
  return { type, data };
}

function sendMessage(message) {
  opened.forEach((node) => {
    node.socket.send(JSON.stringify(message));
  });
}

process.on("uncaughtException", (err) => console.log(err));

PEERS.forEach((peer) => connect(peer));

setTimeout(() => {
  if (Ycoin.transactions.length !== 0) {
    console.log("mining");
    Ycoin.mineTransactions(publicKey);
    console.log("mined and sending replace request");
    sendMessage(
      produceMessage("TYPE_REPLACE_CHAIN", [
        Ycoin.getLastBlock(),
        Ycoin.difficulty,
      ])
    );
    console.log("request sent");
    console.log("chain here: >>>> ", Ycoin);
  }
}, 8000);
