const crypto = require("crypto");
SHA256 = (message) => crypto.createHash("sha256").update(message).digest("hex");
const EC = require("elliptic").ec,
  ec = new EC("secp256k1");

const privateKey = "uuid1";
const keyPair = ec.keyFromPrivate(privateKey, "hex");
const publicKey = keyPair.getPublic("hex");

console.log(keyPair);
console.log(publicKey);
console.log(privateKey);
