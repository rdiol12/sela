/**
 * modules/maplestory/bot-client.js — Headless MapleStory v83 bot client.
 *
 * Connects to Cosmic server via TCP, handles the full MapleStory v83
 * encryption protocol (AES-OFB + custom 6-pass cipher), logs in with
 * auto-register, selects/creates a character, and enters the game world.
 *
 * Once in-game, the bot can:
 *   - Move around maps (sends movement packets)
 *   - Chat (sends general chat messages)
 *   - Change maps (via portal packets)
 *   - Respond to events via an AI callback
 *
 * Usage:
 *   const bot = new MapleBot({ name: 'Bot1', username: 'bot1', password: 'bot1pass' });
 *   await bot.connect();
 *   bot.chat('Hello everyone!');
 *   bot.moveTo(100, 200);
 */

import { createConnection } from 'net';
import { createCipheriv, createHash } from 'crypto';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maple:bot');

// ── Constants ───────────────────────────────────────────────────────────────

const LOGIN_PORT = 8484;
const CHANNEL_BASE_PORT = 7575;
const MAPLE_VERSION = 83;
const LOCALE = 8;

// RecvOpcodes (Client → Server)
const RecvOp = {
  LOGIN_PASSWORD:     0x01,
  SERVERLIST_REQUEST: 0x0B,
  CHARLIST_REQUEST:   0x05,
  CHAR_SELECT:        0x13,
  PLAYER_LOGGEDIN:    0x14,
  REGISTER_PIN:       0x0A,
  AFTER_LOGIN:        0x09,
  CHECK_CHAR_NAME:    0x15,
  CREATE_CHAR:        0x16,
  MOVE_PLAYER:        0x29,
  GENERAL_CHAT:       0x31,
  CHANGE_MAP:         0x26,
  PONG:               0x18,
  CLOSE_RANGE_ATTACK: 0x2C,
  RANGED_ATTACK:      0x2D,
  MAGIC_ATTACK:       0x2E,
  TAKE_DAMAGE:        0x30,
  FACE_EXPRESSION:    0x33,
  NPC_TALK:           0x3A,
  NPC_TALK_MORE:      0x3C,
  NPC_SHOP:           0x3D,
  ITEM_MOVE:          0x47,
  USE_ITEM:           0x48,
  DISTRIBUTE_AP:      0x57,
  HEAL_OVER_TIME:     0x59,
  DISTRIBUTE_SP:      0x5A,
  QUEST_ACTION:       0x6B,
  PARTY_OPERATION:    0x7C,
  ITEM_PICKUP:        0xCA,
  GUILD_OPERATION:    0x7E,
  PLAYER_INTERACTION: 0x7B,  // trade
  MODIFY_BUDDY_LIST:  0x82,
  USE_CASH_ITEM:      0x4F,  // megaphone
  CHANGE_CHANNEL:     0x27,
  SKILL_EFFECT:       0x5D,
  CANCEL_BUFF:        0x5C,
  SPAWN_PET:          0x62,
  PET_COMMAND:        0xA9,
  GIVE_FAME:          0x5F,
  WHISPER:            0x78,
  CHANGE_MAP_SPECIAL: 0x64,
};

// SendOpcodes (Server → Client)
const SendOp = {
  LOGIN_STATUS:       0x00,
  PIN_OPERATION:      0x06,
  PIN_ASSIGNED:       0x07,
  SERVERLIST:         0x0A,
  CHARLIST:           0x0B,
  SERVER_IP:          0x0C,
  CHAR_NAME_RESPONSE: 0x0D,
  ADD_NEW_CHAR_ENTRY: 0x0E,
  PING:               0x11,
  SET_CHANNEL:        0x14,
  MODIFY_INVENTORY:   0x1A,
  UPDATE_STATS:       0x1C,
  INVENTORY_OPERATION: 0x1D,
  SHOW_STATUS_INFO:   0x27,
  PARTY_OPERATION:    0x3E,
  WARP_TO_MAP:        0x7D,
  SPAWN_PLAYER:       0xA0,
  REMOVE_PLAYER:      0xA1,
  CHATTEXT:           0xA2,
  MOVE_PLAYER:        0xB9,
  CLOSE_RANGE_ATTACK: 0xBA,
  RANGED_ATTACK:      0xBB,
  MAGIC_ATTACK:       0xBC,
  DAMAGE_PLAYER:      0xC0,
  SPAWN_MONSTER:      0xEC,
  KILL_MONSTER:       0xED,
  SPAWN_MONSTER_CONTROL: 0xEE,
  SHOW_MONSTER_HP:    0xFA,
  SPAWN_NPC:          0x101,
  DROP_ITEM_FROM_MAPOBJECT: 0x10C,
  REMOVE_ITEM_FROM_MAP: 0x10D,
  NPC_TALK:           0x130,
  OPEN_NPC_SHOP:      0x131,
  CONFIRM_SHOP_TRANSACTION: 0x132,
  GUILD_OPERATION:    0x41,
  CANCEL_BUFF:        0x21,
  SKILL_EFFECT:       0xBE,
  PLAYER_INTERACTION: 0x13A, // trade
  SPAWN_PET:          0xA8,
  PET_COMMAND:        0xAE,
  CHANGE_CHANNEL:     0x10,
  BUDDYLIST:          0x3F,
  FAME_RESPONSE:      0x26,
  WHISPER:            0x87,
};

// ── Maple AES Key (hardcoded in server) ─────────────────────────────────────

const AES_KEY = Buffer.from([
  0x13, 0x00, 0x00, 0x00,
  0x08, 0x00, 0x00, 0x00,
  0x06, 0x00, 0x00, 0x00,
  0xB4, 0x00, 0x00, 0x00,
  0x1B, 0x00, 0x00, 0x00,
  0x0F, 0x00, 0x00, 0x00,
  0x33, 0x00, 0x00, 0x00,
  0x52, 0x00, 0x00, 0x00,
]);

// ── funnyBytes substitution table ───────────────────────────────────────────

const FUNNY_BYTES = Buffer.from([
  0xEC,0x3F,0x77,0xA4,0x45,0xD0,0x71,0xBF,0xB7,0x98,0x20,0xFC,0x4B,0xE9,0xB3,0xE1,
  0x5C,0x22,0xF7,0x0C,0x44,0x1B,0x81,0xBD,0x63,0x8D,0xD4,0xC3,0xF2,0x10,0x19,0xE0,
  0xFB,0xA1,0x6E,0x66,0xEA,0xAE,0xD6,0xCE,0x06,0x18,0x4E,0xEB,0x78,0x95,0xDB,0xBA,
  0xB6,0x42,0x7A,0x2A,0x83,0x0B,0x54,0x67,0x6D,0xE8,0x65,0xE7,0x2F,0x07,0xF3,0xAA,
  0x27,0x7B,0x85,0xB0,0x26,0xFD,0x8B,0xA9,0xFA,0xBE,0xA8,0xD7,0xCB,0xCC,0x92,0xDA,
  0xF9,0x93,0x60,0x2D,0xDD,0xD2,0xA2,0x9B,0x39,0x5F,0x82,0x21,0x4C,0x69,0xF8,0x31,
  0x87,0xEE,0x8E,0xAD,0x8C,0x6A,0xBC,0xB5,0x6B,0x59,0x13,0xF1,0x04,0x00,0xF6,0x5A,
  0x35,0x79,0x48,0x8F,0x15,0xCD,0x97,0x57,0x12,0x3E,0x37,0xFF,0x9D,0x4F,0x51,0xF5,
  0xA3,0x70,0xBB,0x14,0x75,0xC2,0xB8,0x72,0xC0,0xED,0x7D,0x68,0xC9,0x2E,0x0D,0x62,
  0x46,0x17,0x11,0x4D,0x6C,0xC4,0x7E,0x53,0xC1,0x25,0xC7,0x9A,0x1C,0x88,0x58,0x2C,
  0x89,0xDC,0x02,0x64,0x40,0x01,0x5D,0x38,0xA5,0xE2,0xAF,0x55,0xD5,0xEF,0x1A,0x7C,
  0xA7,0x5B,0xA6,0x6F,0x86,0x9F,0x73,0xE6,0x0A,0xDE,0x2B,0x99,0x4A,0x47,0x9C,0xDF,
  0x09,0x76,0x9E,0x30,0x0E,0xE4,0xB2,0x94,0xA0,0x3B,0x34,0x1D,0x28,0x0F,0x36,0xE3,
  0x23,0xB4,0x03,0xD8,0x90,0xC8,0x3C,0xFE,0x5E,0x32,0x24,0x50,0x1F,0x3A,0x43,0x8A,
  0x96,0x41,0x74,0xAC,0x52,0x33,0xF0,0xD9,0x29,0x80,0xB1,0x16,0xD3,0xAB,0x91,0xB9,
  0x84,0x7F,0x61,0x1E,0xCF,0xC5,0xD1,0x56,0x3D,0xCA,0xF4,0x05,0xC6,0xE5,0x08,0x49,
]);

// ── Crypto helpers ──────────────────────────────────────────────────────────

function rollLeft(byte, count) {
  const tmp = (byte & 0xFF) << (count % 8);
  return ((tmp & 0xFF) | (tmp >> 8)) & 0xFF;
}

function rollRight(byte, count) {
  const tmp = ((byte & 0xFF) << 8) >>> (count % 8);
  return ((tmp & 0xFF) | (tmp >>> 8)) & 0xFF;
}

function mapleCustomEncrypt(data) {
  const buf = Buffer.from(data);
  for (let j = 0; j < 6; j++) {
    let remember = 0;
    let dataLength = buf.length & 0xFF;
    if (j % 2 === 0) {
      for (let i = 0; i < buf.length; i++) {
        let cur = buf[i];
        cur = rollLeft(cur, 3);
        cur = (cur + dataLength) & 0xFF;
        cur ^= remember;
        remember = cur;
        cur = rollRight(cur, dataLength & 0xFF);
        cur = (~cur) & 0xFF;
        cur = (cur + 0x48) & 0xFF;
        dataLength = (dataLength - 1) & 0xFF;
        buf[i] = cur;
      }
    } else {
      for (let i = buf.length - 1; i >= 0; i--) {
        let cur = buf[i];
        cur = rollLeft(cur, 4);
        cur = (cur + dataLength) & 0xFF;
        cur ^= remember;
        remember = cur;
        cur ^= 0x13;
        cur = rollRight(cur, 3);
        dataLength = (dataLength - 1) & 0xFF;
        buf[i] = cur;
      }
    }
  }
  return buf;
}

function mapleCustomDecrypt(data) {
  const buf = Buffer.from(data);
  for (let j = 1; j <= 6; j++) {
    let remember = 0;
    let dataLength = buf.length & 0xFF;
    if (j % 2 === 0) {
      for (let i = 0; i < buf.length; i++) {
        let cur = buf[i];
        cur = (cur - 0x48) & 0xFF;
        cur = (~cur) & 0xFF;
        cur = rollLeft(cur, dataLength & 0xFF);
        const nextRemember = cur;
        cur ^= remember;
        remember = nextRemember;
        cur = (cur - dataLength) & 0xFF;
        cur = rollRight(cur, 3);
        buf[i] = cur;
        dataLength = (dataLength - 1) & 0xFF;
      }
    } else {
      for (let i = buf.length - 1; i >= 0; i--) {
        let cur = buf[i];
        cur = rollLeft(cur, 3);
        cur ^= 0x13;
        const nextRemember = cur;
        cur ^= remember;
        remember = nextRemember;
        cur = (cur - dataLength) & 0xFF;
        cur = rollRight(cur, 4);
        buf[i] = cur;
        dataLength = (dataLength - 1) & 0xFF;
      }
    }
  }
  return buf;
}

function funnyShit(inputByte, iv) {
  const input = inputByte & 0xFF;
  let elina = iv[1] & 0xFF;
  let moritz = FUNNY_BYTES[elina];
  moritz = (moritz - input) & 0xFF;
  iv[0] = (iv[0] + moritz) & 0xFF;
  moritz = iv[2] & 0xFF;
  moritz ^= FUNNY_BYTES[input];
  elina = (elina - moritz) & 0xFF;
  iv[1] = elina;
  elina = iv[3] & 0xFF;
  moritz = elina;
  elina = (elina - iv[0]) & 0xFF;
  moritz = FUNNY_BYTES[moritz & 0xFF];
  moritz = (moritz + input) & 0xFF;
  moritz ^= iv[2];
  iv[2] = moritz & 0xFF;
  elina = (elina + (FUNNY_BYTES[input] & 0xFF)) & 0xFF;
  iv[3] = elina;

  // Rotate the 32-bit value left by 3
  let val = (iv[0] & 0xFF) | ((iv[1] & 0xFF) << 8) | ((iv[2] & 0xFF) << 16) | ((iv[3] & 0xFF) << 24);
  val = ((val << 3) | (val >>> 29)) >>> 0;
  iv[0] = val & 0xFF;
  iv[1] = (val >> 8) & 0xFF;
  iv[2] = (val >> 16) & 0xFF;
  iv[3] = (val >> 24) & 0xFF;
}

function getNewIv(oldIv) {
  const newIv = Buffer.from([0xF2, 0x53, 0x50, 0xC6]);
  for (let i = 0; i < 4; i++) {
    funnyShit(oldIv[i], newIv);
  }
  return newIv;
}

function multiplyBytes(iv, count, mul) {
  const size = count * mul;
  const ret = Buffer.alloc(size);
  for (let x = 0; x < size; x++) {
    ret[x] = iv[x % count];
  }
  return ret;
}

function aesCrypt(data, iv) {
  const buf = Buffer.from(data);
  let remaining = buf.length;
  let llength = 0x5B0;
  let start = 0;
  while (remaining > 0) {
    let myIv = multiplyBytes(iv, 4, 4); // 16 bytes from 4-byte IV
    if (remaining < llength) llength = remaining;
    for (let x = start; x < start + llength; x++) {
      if ((x - start) % myIv.length === 0) {
        // AES-ECB encrypt the IV block
        const cipher = createCipheriv('aes-256-ecb', AES_KEY, null);
        cipher.setAutoPadding(false);
        const encrypted = cipher.update(myIv);
        cipher.final();
        encrypted.copy(myIv);
      }
      buf[x] ^= myIv[(x - start) % myIv.length];
    }
    start += llength;
    remaining -= llength;
    llength = 0x5B4;
  }
  return buf;
}

// ── Cipher class ────────────────────────────────────────────────────────────

class MapleCipher {
  constructor(iv, version) {
    this.iv = Buffer.from(iv);
    this.version = ((version >> 8) & 0xFF) | ((version << 8) & 0xFF00);
  }

  encrypt(data) {
    const encrypted = mapleCustomEncrypt(data);
    const result = aesCrypt(encrypted, this.iv);
    this.iv = getNewIv(this.iv);
    return result;
  }

  decrypt(data) {
    const decrypted = aesCrypt(data, this.iv);
    this.iv = getNewIv(this.iv);
    return mapleCustomDecrypt(decrypted);
  }

  getPacketHeader(length) {
    let iiv = (this.iv[3] & 0xFF) | ((this.iv[2] & 0xFF) << 8);
    iiv ^= this.version;
    const mlength = ((length << 8) & 0xFF00) | (length >>> 8);
    const xoredIv = iiv ^ mlength;
    const header = Buffer.alloc(4);
    header[0] = (iiv >>> 8) & 0xFF;
    header[1] = iiv & 0xFF;
    header[2] = (xoredIv >>> 8) & 0xFF;
    header[3] = xoredIv & 0xFF;
    return header;
  }

  isValidHeader(header) {
    return ((header[0] ^ this.iv[2]) & 0xFF) === ((this.version >> 8) & 0xFF)
        && ((header[1] ^ this.iv[3]) & 0xFF) === (this.version & 0xFF);
  }

  static decodeLength(header) {
    return (((header[1] ^ header[3]) & 0xFF) << 8) | ((header[0] ^ header[2]) & 0xFF);
  }
}

// ── Packet builder helpers ──────────────────────────────────────────────────

class PacketWriter {
  constructor(opcode) {
    this.parts = [];
    if (opcode !== undefined) {
      this.writeShort(opcode);
    }
  }

  writeByte(v)  { const b = Buffer.alloc(1); b[0] = v & 0xFF; this.parts.push(b); return this; }
  writeShort(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xFFFF, 0); this.parts.push(b); return this; }
  writeInt(v)   { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); this.parts.push(b); return this; }
  writeLong(v)  { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v), 0); this.parts.push(b); return this; }

  writeString(s) {
    const strBuf = Buffer.from(s, 'utf-8');
    this.writeShort(strBuf.length);
    this.parts.push(strBuf);
    return this;
  }

  writeBytes(buf) { this.parts.push(Buffer.from(buf)); return this; }
  writeZero(n)    { this.parts.push(Buffer.alloc(n)); return this; }

  build() { return Buffer.concat(this.parts); }
}

class PacketReader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  readByte()  { return this.buf[this.pos++]; }
  readShort() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  readInt()   { const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  readLong()  { const v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return v; }

  readString() {
    const len = this.readShort();
    const s = this.buf.toString('utf-8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  readBytes(n) {
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  skip(n) { this.pos += n; }
  remaining() { return this.buf.length - this.pos; }
}

// ── Bot Client ──────────────────────────────────────────────────────────────

export class MapleBot extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name       = opts.name || 'CosmicBot';
    this.username   = (opts.username || `bot${Date.now() % 1000000}`).substring(0, 13);
    this.password   = opts.password || 'botpass123';
    this.host       = opts.host || '127.0.0.1';
    this.gender     = opts.gender ?? 0; // 0=male, 1=female
    this.skinColor  = opts.skinColor ?? 0;
    this.hairColor  = opts.hairColor ?? 0;
    this.hair       = opts.hair ?? 30030; // default male hair
    this.face       = opts.face ?? 20000; // default male face
    this.top        = opts.top ?? 1040002;
    this.bottom     = opts.bottom ?? 1060002;
    this.shoes      = opts.shoes ?? 1072001;
    this.weapon     = opts.weapon ?? 1302000;

    this.socket     = null;
    this.sendCipher = null;
    this.recvCipher = null;
    this.recvBuf    = Buffer.alloc(0);
    this.state      = 'disconnected'; // disconnected, hello, login, charselect, channel_connect, ingame
    this.charId     = 0;
    this.channelPort = 0;
    this.channelIp  = '127.0.0.1';
    this.mapId      = 0;
    this.x          = 0;
    this.y          = 0;
    this.fh         = 0;             // current foothold (0 = unknown/airborne)
    this.playersNearby = new Map();   // playerId → name
    this.monstersNearby = new Map();  // oid → { mobId, hp, maxHp, x, y, fh }
    this.dropsNearby = new Map();     // oid → { itemId, isMeso, amount, x, y }
    this.npcsNearby = new Map();      // oid → { npcId, x, y }
    this.inventory = {                // simplified inventory tracking
      equip: new Map(),   // slot → { itemId, quantity }
      use: new Map(),     // slot → { itemId, quantity }
      setup: new Map(),   // slot → { itemId, quantity }
      etc: new Map(),     // slot → { itemId, quantity }
      cash: new Map(),    // slot → { itemId, quantity }
    };
    this.stats = { hp: 50, maxHp: 50, mp: 5, maxMp: 5, str: 4, dex: 4, int: 4, luk: 4, exp: 0, level: 1, fame: 0, meso: 0 };
    this.jobId = 0;               // 0=Beginner, 100=Warrior, 200=Mage, etc.
    this.ap = 0;                  // available ability points
    this.sp = 0;                  // available skill points
    this.skills = new Map();      // skillId → level
    this.partyId = 0;
    this.guildId = 0;
    this.guildName = '';
    this.buddyList = new Map();       // charId → { name, group, channel }
    this.inTrade = false;
    this.tradePartner = '';
    this.petId = 0;
    this.channelId = 0;
    this.buffActive = new Set();      // set of active buff skill IDs
    this.lastFameTime = 0;            // timestamp of last fame given
    this.lootFilter = null;           // null=pickup all, Set of allowed item IDs, or function(itemId)=>bool
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._autoReconnect = false;
    this.portals = new Map();         // portalName → { x, y, targetMap, targetPortal, type }
    this.inNpcChat = false;           // true when in NPC dialog
    this.inShop = false;              // true when shop is open
    this.shopItems = [];              // items in current shop

    // For hello packet parsing
    this._helloReceived = false;
  }

  // ── Account setup (pre-create via MySQL) ─────────────────────────────

  static ensureAccountSync(username, password) {
    const MYSQL = 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe';
    try {
      const check = execSync(`"${MYSQL}" -u root cosmic -N -e "SELECT COUNT(*) FROM accounts WHERE name='${username}';"`, { encoding: 'utf-8' }).trim();
      if (parseInt(check) > 0) {
        execSync(`"${MYSQL}" -u root cosmic -e "UPDATE accounts SET tos=1 WHERE name='${username}';"`, { encoding: 'utf-8' });
        return true;
      }

      const hash = createHash('sha512').update(password, 'utf-8').digest('hex');
      execSync(`"${MYSQL}" -u root cosmic -e "INSERT INTO accounts (name, password, birthday, tempban, tos) VALUES ('${username}', '${hash}', '2005-05-11', '2005-05-11 00:00:00', 1);"`, { encoding: 'utf-8' });
      log.info({ username }, 'Bot account created via MySQL');
      return true;
    } catch (err) {
      log.warn({ username, err: err.message }, 'Failed to pre-create account');
      return false;
    }
  }

  // ── Connection ──────────────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      this.state = 'hello';
      this._helloReceived = false;
      this.recvBuf = Buffer.alloc(0);
      this._connectResolve = resolve;
      this._connectReject = reject;

      log.info({ bot: this.name, host: this.host, port: LOGIN_PORT }, 'Connecting to login server');
      this.socket = createConnection(LOGIN_PORT, this.host);
      this.socket.on('data', (data) => this._onData(data));
      this.socket.on('error', (err) => {
        log.error({ bot: this.name, err: err.message }, 'Socket error');
        this.emit('error', err);
        if (this._connectReject) { this._connectReject(err); this._connectReject = null; }
      });
      this.socket.on('close', () => {
        log.info({ bot: this.name, state: this.state }, 'Socket closed');
        if (this.state === 'channel_connect') {
          // Expected disconnect — reconnecting to channel server
          this._connectToChannel();
        } else {
          this.emit('disconnect');
        }
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.state = 'disconnected';
  }

  // ── Data handler ────────────────────────────────────────────────────────

  _onData(data) {
    this.recvBuf = Buffer.concat([this.recvBuf, data]);

    // Guard: prevent runaway memory from malformed/flood data (1MB cap)
    if (this.recvBuf.length > 1024 * 1024) {
      log.error({ bot: this.name, bufLen: this.recvBuf.length }, 'recvBuf overflow — disconnecting');
      this.disconnect();
      return;
    }

    // First packet is the unencrypted hello
    if (!this._helloReceived) {
      if (this.recvBuf.length < 2) return;
      const helloLen = this.recvBuf.readUInt16LE(0);
      if (this.recvBuf.length < 2 + helloLen) return;

      const helloBuf = this.recvBuf.subarray(2, 2 + helloLen);
      this.recvBuf = this.recvBuf.subarray(2 + helloLen);
      this._helloReceived = true;
      this._handleHello(helloBuf);
      // Process any remaining data
      if (this.recvBuf.length > 0) this._processPackets();
      return;
    }

    this._processPackets();
  }

  _processPackets() {
    while (this.recvBuf.length >= 4) {
      const header = this.recvBuf.subarray(0, 4);

      if (!this.recvCipher.isValidHeader(header)) {
        log.warn({ bot: this.name }, 'Invalid packet header, clearing buffer');
        this.recvBuf = Buffer.alloc(0);
        return;
      }

      const packetLength = MapleCipher.decodeLength(header);
      if (this.recvBuf.length < 4 + packetLength) return; // incomplete

      const encryptedData = Buffer.from(this.recvBuf.subarray(4, 4 + packetLength));
      this.recvBuf = this.recvBuf.subarray(4 + packetLength);

      const decrypted = this.recvCipher.decrypt(encryptedData);
      this._handlePacket(decrypted);
    }
  }

  // ── Hello ───────────────────────────────────────────────────────────────

  _handleHello(buf) {
    const r = new PacketReader(buf);
    const version = r.readShort();
    const patch = r.readShort();
    const locale = r.readByte();
    const recvIv = r.readBytes(4);
    const sendIv = r.readBytes(4);
    const gameLocale = r.readByte();

    log.info({ bot: this.name, version, patch }, 'Hello received');

    // Client SENDS using server's recvIv (version 83 to match server's receive cipher)
    this.sendCipher = new MapleCipher(recvIv, MAPLE_VERSION);
    // Client RECEIVES using server's sendIv (version 0xFFFF-83 to match server's send cipher)
    this.recvCipher = new MapleCipher(sendIv, 0xFFFF - MAPLE_VERSION);

    if (this._onChannelHello) {
      this._onChannelHello = false;
      this._sendPlayerLoggedIn();
    } else {
      this._sendLogin();
    }
  }

  // ── Packet handler ──────────────────────────────────────────────────────

  _handlePacket(data) {
    if (data.length < 2) return;
    const opcode = data.readUInt16LE(0);
    const payload = data.subarray(2);

    // Debug: log all opcodes received after channel connect
    if (this.state === 'ingame' || this._onChannelHello) {
      log.info({ bot: this.name, opcode: '0x' + opcode.toString(16), len: payload.length }, 'RX packet');
    }

    switch (opcode) {
      case SendOp.LOGIN_STATUS:     this._onLoginStatus(payload); break;
      case SendOp.PIN_OPERATION:
      case SendOp.PIN_ASSIGNED:     this._onPinRequest(opcode); break;
      case SendOp.SERVERLIST:       this._onServerList(payload); break;
      case SendOp.CHARLIST:         this._onCharList(payload); break;
      case SendOp.SERVER_IP:        this._onServerIp(payload); break;
      case SendOp.CHAR_NAME_RESPONSE: this._onCharNameResponse(payload); break;
      case SendOp.ADD_NEW_CHAR_ENTRY: this._onNewCharEntry(payload); break;
      case SendOp.PING:             this._onPing(); break;
      case SendOp.WARP_TO_MAP:      this._onWarpToMap(payload); break;
      case SendOp.CHATTEXT:         this._onChatText(payload); break;
      case SendOp.SPAWN_PLAYER:     this._onSpawnPlayer(payload); break;
      case SendOp.REMOVE_PLAYER:    this._onRemovePlayer(payload); break;
      case SendOp.SPAWN_MONSTER:
      case SendOp.SPAWN_MONSTER_CONTROL: this._onSpawnMonster(payload); break;
      case SendOp.KILL_MONSTER:      this._onKillMonster(payload); break;
      case SendOp.SHOW_MONSTER_HP:   this._onShowMonsterHp(payload); break;
      case SendOp.DROP_ITEM_FROM_MAPOBJECT: this._onDropItem(payload); break;
      case SendOp.REMOVE_ITEM_FROM_MAP:    this._onRemoveItem(payload); break;
      case SendOp.DAMAGE_PLAYER:     this._onDamagePlayer(payload); break;
      case SendOp.UPDATE_STATS:      this._onUpdateStats(payload); break;
      case SendOp.SPAWN_NPC:         this._onSpawnNpc(payload); break;
      case SendOp.NPC_TALK:          this._onNpcTalk(payload); break;
      case SendOp.OPEN_NPC_SHOP:     this._onOpenShop(payload); break;
      case SendOp.CONFIRM_SHOP_TRANSACTION: this._onShopResult(payload); break;
      case SendOp.PARTY_OPERATION:   this._onPartyOperation(payload); break;
      case SendOp.SHOW_STATUS_INFO:  this._onStatusInfo(payload); break;
      case SendOp.GUILD_OPERATION:   this._onGuildOperation(payload); break;
      case SendOp.PLAYER_INTERACTION: this._onPlayerInteraction(payload); break;
      case SendOp.BUDDYLIST:         this._onBuddyList(payload); break;
      case SendOp.CANCEL_BUFF:       this._onCancelBuff(payload); break;
      case SendOp.SKILL_EFFECT:      this._onSkillEffect(payload); break;
      case SendOp.SPAWN_PET:         this._onSpawnPet(payload); break;
      case SendOp.CHANGE_CHANNEL:    this._onChangeChannel(payload); break;
      case SendOp.FAME_RESPONSE:     this._onFameResponse(payload); break;
      case SendOp.WHISPER:           this._onWhisper(payload); break;
      default: break;
    }
  }

  // ── Send helpers ────────────────────────────────────────────────────────

  _sendPacket(data) {
    if (!this.socket || this.socket.destroyed) return;
    const header = this.sendCipher.getPacketHeader(data.length);
    const encrypted = this.sendCipher.encrypt(data);
    const packet = Buffer.concat([header, encrypted]);
    if (data.length >= 2) {
      const op = data.readUInt16LE(0);
      if (op === 0x14) { // PLAYER_LOGGEDIN
        log.info({ bot: this.name, rawLen: data.length, encLen: packet.length, header: header.toString('hex'), raw: data.toString('hex') }, 'TX PLAYER_LOGGEDIN packet');
      }
    }
    this.socket.write(packet);
  }

  // ── Login flow ──────────────────────────────────────────────────────────

  _sendLogin() {
    this.state = 'login';
    const pkt = new PacketWriter(RecvOp.LOGIN_PASSWORD);
    pkt.writeString(this.username);
    pkt.writeString(this.password);
    pkt.writeZero(6);   // padding
    pkt.writeInt(0x12345678); // HWID nonce (non-zero)
    this._sendPacket(pkt.build());
    log.info({ bot: this.name, username: this.username }, 'Login sent');
  }

  _onLoginStatus(payload) {
    const r = new PacketReader(payload);
    const result = r.readInt();

    if (result === 23 && !this._tosRetried) {
      // TOS not accepted — retry once (auto-register creates account but TOS=0)
      log.info({ bot: this.name }, 'TOS not accepted, reconnecting...');
      this._tosRetried = true;
      this._acceptTosAndRetry();
      return;
    }

    if (result === 5 && !this._loginRetried) {
      // Account not found — auto-register may have created it, retry on new connection
      log.info({ bot: this.name }, 'Account not found (auto-register triggered), reconnecting...');
      this._loginRetried = true;
      this.socket.destroy();
      setTimeout(() => this._reconnectLogin(), 1000);
      return;
    }

    if (result !== 0) {
      log.error({ bot: this.name, result }, 'Login failed');
      this.emit('error', new Error(`Login failed with code ${result}`));
      this.disconnect();
      return;
    }

    log.info({ bot: this.name }, 'Login successful');
    this._requestServerList();
  }

  async _acceptTosAndRetry() {
    // Set TOS=1 in database, then reconnect
    try {
      const { default: DatabaseConnection } = await import('../../lib/db.js').catch(() => ({}));
      // Direct MySQL update if we have access, otherwise just reconnect and hope
    } catch {}
    // Reconnect — the server may auto-set TOS on second login
    this.socket.destroy();
    setTimeout(() => this._reconnectLogin(), 1000);
  }

  _reconnectLogin() {
    this._helloReceived = false;
    this._onChannelHello = false;
    this.recvBuf = Buffer.alloc(0);
    this.state = 'hello';

    this.socket = createConnection(LOGIN_PORT, this.host);
    this.socket.on('data', (data) => this._onData(data));
    this.socket.on('error', (err) => {
      log.error({ bot: this.name, err: err.message }, 'Reconnect socket error');
      this.emit('error', err);
    });
    this.socket.on('close', () => {
      if (this.state === 'channel_connect') {
        this._connectToChannel();
      } else if (this.state !== 'hello') {
        this.emit('disconnect');
      }
    });
  }

  _onPinRequest(opcode) {
    log.info({ bot: this.name, opcode: '0x' + opcode.toString(16) }, 'PIN request — sending AFTER_LOGIN to skip');
    const pkt = new PacketWriter(RecvOp.AFTER_LOGIN);
    pkt.writeByte(0x01); // mode 1 = skip/register PIN
    pkt.writeByte(0x00);
    this._sendPacket(pkt.build());
  }

  _requestServerList() {
    const pkt = new PacketWriter(RecvOp.SERVERLIST_REQUEST);
    this._sendPacket(pkt.build());
  }

  _onServerList(payload) {
    const r = new PacketReader(payload);
    const worldId = r.readByte();
    if (worldId === 0xFF) {
      // End of server list, request char list for world 0
      this._requestCharList();
      return;
    }
    // Just consume the server list data
  }

  _requestCharList() {
    this.state = 'charselect';
    const pkt = new PacketWriter(RecvOp.CHARLIST_REQUEST);
    pkt.writeInt(0);  // world 0
    pkt.writeInt(0);  // channel 0
    this._sendPacket(pkt.build());
  }

  _onCharList(payload) {
    const r = new PacketReader(payload);
    const status = r.readByte();
    if (status !== 0) {
      log.error({ bot: this.name, status }, 'Char list error');
      return;
    }

    const charCount = r.readByte();
    log.info({ bot: this.name, charCount }, 'Character list received');

    if (charCount > 0) {
      // Read first character ID
      this.charId = r.readInt();
      log.info({ bot: this.name, charId: this.charId }, 'Selecting existing character');
      this._selectChar();
    } else {
      // Need to create a character
      log.info({ bot: this.name }, 'No characters, creating one');
      this._checkCharName();
    }
  }

  _checkCharName() {
    const pkt = new PacketWriter(RecvOp.CHECK_CHAR_NAME);
    pkt.writeString(this.name);
    this._sendPacket(pkt.build());
  }

  _onCharNameResponse(payload) {
    const r = new PacketReader(payload);
    const name = r.readString();
    const nameUsed = r.readByte();

    if (nameUsed !== 0) {
      // Name taken, append random digits
      this.name = this.name.substring(0, 9) + Math.floor(Math.random() * 999);
      log.info({ bot: this.name }, 'Name taken, trying new name');
      this._checkCharName();
      return;
    }

    this._createChar();
  }

  _createChar() {
    const pkt = new PacketWriter(RecvOp.CREATE_CHAR);
    pkt.writeString(this.name);
    pkt.writeInt(0);              // job (0 = Beginner)
    pkt.writeInt(this.face);
    pkt.writeInt(this.hair);
    pkt.writeInt(this.hairColor);
    pkt.writeInt(this.skinColor);
    pkt.writeInt(this.top);
    pkt.writeInt(this.bottom);
    pkt.writeInt(this.shoes);
    pkt.writeInt(this.weapon);
    pkt.writeByte(this.gender);
    this._sendPacket(pkt.build());
    log.info({ bot: this.name }, 'Character creation sent');
  }

  _onNewCharEntry(payload) {
    const r = new PacketReader(payload);
    const flag = r.readByte();
    if (flag !== 0) {
      log.error({ bot: this.name, flag }, 'Character creation failed');
      return;
    }
    // Read char ID from the char entry
    this.charId = r.readInt();
    log.info({ bot: this.name, charId: this.charId }, 'Character created');
    this._selectChar();
  }

  _selectChar() {
    const pkt = new PacketWriter(RecvOp.CHAR_SELECT);
    pkt.writeInt(this.charId);
    // Generate unique MAC/HWID per bot to avoid HWID limits
    const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
    const id = this.charId || Math.floor(Math.random() * 0xFFFFFF);
    const mac = `${hex((id >> 16) & 0xFF)}-${hex((id >> 8) & 0xFF)}-${hex(id & 0xFF)}-00-00-01`;
    const hwid = `${mac.replace(/-/g, '')}_${hex(id)}000000`;
    pkt.writeString(mac);
    pkt.writeString(hwid);
    this._sendPacket(pkt.build());
    log.info({ bot: this.name, charId: this.charId }, 'Character selected');
  }

  _onServerIp(payload) {
    const r = new PacketReader(payload);
    r.skip(2);  // padding
    const ip1 = r.readByte();
    const ip2 = r.readByte();
    const ip3 = r.readByte();
    const ip4 = r.readByte();
    this.channelPort = r.readShort();
    this.channelIp = `${ip1}.${ip2}.${ip3}.${ip4}`;

    log.info({ bot: this.name, ip: this.channelIp, port: this.channelPort }, 'Channel server address received');

    // Override channel IP to match login IP so server HWID cache lookup succeeds
    this.channelIp = this.host;

    // Mark state and close login socket — will reconnect in close handler
    this.state = 'channel_connect';
    this.socket.destroy();
  }

  _connectToChannel() {
    this._helloReceived = false;
    this.recvBuf = Buffer.alloc(0);

    log.info({ bot: this.name, ip: this.channelIp, port: this.channelPort }, 'Connecting to channel server');

    this.socket = createConnection(this.channelPort, this.channelIp);
    this._channelBytesReceived = 0;
    this.socket.on('data', (data) => {
      this._channelBytesReceived += data.length;
      this._onData(data);
    });
    this.socket.on('error', (err) => {
      log.error({ bot: this.name, err: err.message }, 'Channel socket error');
      this.emit('error', err);
    });
    this.socket.on('close', () => {
      if (this.state !== 'channel_connect') {
        log.info({ bot: this.name }, 'Channel socket closed');
        this.state = 'disconnected';
        this.emit('disconnect');
        this._tryReconnect();
      }
    });

    // Override hello handler to send PLAYER_LOGGEDIN after hello
    this._onChannelHello = true;
  }

  _sendPlayerLoggedIn() {
    this.state = 'ingame';
    const pkt = new PacketWriter(RecvOp.PLAYER_LOGGEDIN);
    pkt.writeInt(this.charId);
    this._sendPacket(pkt.build());
    log.info({ bot: this.name, charId: this.charId }, 'Player logged in to channel');

    if (this._connectResolve) {
      this._connectResolve();
      this._connectResolve = null;
    }
    this.emit('ready');
  }

  // ── In-game handlers ────────────────────────────────────────────────────

  _onPing() {
    const pkt = new PacketWriter(RecvOp.PONG);
    this._sendPacket(pkt.build());
  }

  _onWarpToMap(payload) {
    try {
      const r = new PacketReader(payload);
      r.skip(4); // channel - 1
      const isCharInfo = r.readByte(); // 1 = first login (getCharInfo), 0 = regular warp
      if (isCharInfo === 1) {
        // getCharInfo remainder: byte(1) + short(0) + 3x int(rand) = 15 bytes
        r.skip(15);
        // addCharacterInfo: long(-1) + byte(0) = 9 bytes
        r.skip(9);
        // addCharStats: charId(4), name(13), gender(1), skin(1), face(4), hair(4),
        // pets(24), level(1), job(2), stats(8), hp(4), mp(4), ap(2), sp(2), exp(4), fame(2), gachaExp(4)
        this.charId = r.readInt();
        r.skip(13 + 1 + 1 + 4 + 4 + 24 + 1 + 2 + 8 + 4 + 4 + 2 + 2 + 4 + 2 + 4); // 80 bytes
        this.mapId = r.readInt();
        log.info({ bot: this.name, charId: this.charId, mapId: this.mapId, charInfo: true }, 'Initial map data received');
        this._clearMapState();
        this.emit('mapChanged', this.mapId);
      } else {
        r.skip(4);
        this.mapId = r.readInt();
        const spawnPoint = r.readByte();
        const hp = r.readShort();
        this.stats.hp = hp;
        log.info({ bot: this.name, mapId: this.mapId, spawnPoint, hp }, 'Warped to map');
        this._clearMapState();
        this.emit('mapChanged', this.mapId);
      }
    } catch { /* warp packet structure varies */ }
  }

  _onChatText(payload) {
    try {
      const r = new PacketReader(payload);
      const playerId = r.readInt();
      const message = r.readString();
      this.emit('chat', { playerId, message });
    } catch {
      // ignore
    }
  }

  _onSpawnPlayer(payload) {
    try {
      const r = new PacketReader(payload);
      const playerId = r.readInt();
      const playerName = r.readString();
      this.playersNearby.set(playerId, playerName);
      this.emit('playerSpawn', { playerId, playerName });
    } catch {
      // ignore
    }
  }

  _onRemovePlayer(payload) {
    try {
      const r = new PacketReader(payload);
      const playerId = r.readInt();
      this.playersNearby.delete(playerId);
      this.emit('playerLeave', { playerId });
    } catch { /* ignore */ }
  }

  // ── Monster/NPC/Drop server→client handlers ──────────────────────────

  _onSpawnMonster(payload) {
    try {
      const r = new PacketReader(payload);
      const oid = r.readInt();
      r.skip(1); // controller status
      const mobId = r.readInt();
      // Skip temp buffs (16 bytes for control, varies for broadcast)
      r.skip(16);
      const x = r.readShort();
      const y = r.readShort();
      const stance = r.readByte();
      const fh = r.readShort(); // foothold — used for realistic movement
      this.monstersNearby.set(oid, { mobId, x, y, fh, hp: 100, maxHp: 100 });
      this.emit('monsterSpawn', { oid, mobId, x, y, fh });
    } catch { /* partial parse is fine — we still get oid/mobId */ }
  }

  _onKillMonster(payload) {
    try {
      const r = new PacketReader(payload);
      const oid = r.readInt();
      const mob = this.monstersNearby.get(oid);
      this.monstersNearby.delete(oid);
      this.emit('monsterKill', { oid, mobId: mob?.mobId });
    } catch { /* ignore */ }
  }

  _onShowMonsterHp(payload) {
    try {
      const r = new PacketReader(payload);
      const oid = r.readInt();
      const hpPercent = r.readByte();
      const mob = this.monstersNearby.get(oid);
      if (mob) mob.hp = hpPercent;
      this.emit('monsterHp', { oid, hpPercent });
    } catch { /* ignore */ }
  }

  _onDropItem(payload) {
    try {
      const r = new PacketReader(payload);
      const mod = r.readByte();
      const oid = r.readInt();
      const isMeso = r.readByte() === 1;
      const itemId = r.readInt(); // item ID or meso amount
      r.skip(4); // owner
      r.skip(1); // drop type
      const x = r.readShort();
      const y = r.readShort();
      this.dropsNearby.set(oid, { itemId, isMeso, amount: isMeso ? itemId : 1, x, y });
      this.emit('itemDrop', { oid, itemId, isMeso, x, y });
    } catch { /* ignore */ }
  }

  _onRemoveItem(payload) {
    try {
      const r = new PacketReader(payload);
      const animation = r.readByte(); // 0=expire, 1=no anim, 2=pickup, 4=explode, 5=pet
      const oid = r.readInt();
      this.dropsNearby.delete(oid);
      this.emit('itemRemove', { oid, animation });
    } catch { /* ignore */ }
  }

  _onDamagePlayer(payload) {
    try {
      const r = new PacketReader(payload);
      const charId = r.readInt();
      const damagefrom = r.readByte(); // -1=mob, -2=mob magic, -3=fall, -4=other
      if (charId !== this.charId) return; // not us
      if (damagefrom === -3 || damagefrom === -4) {
        // fall damage or other — skip mob info
        if (damagefrom === -3) r.skip(4);
      } else {
        const mobId = r.readInt();
        r.skip(1); // direction
      }
      // Read damage after mob/direction info
      const damage = r.readInt();
      if (damage > 0) {
        this.stats.hp = Math.max(0, this.stats.hp - damage);
        this.emit('damaged', { damage, hp: this.stats.hp, damagefrom });
      }
    } catch { /* ignore */ }
  }

  _onUpdateStats(payload) {
    try {
      const r = new PacketReader(payload);
      r.skip(1); // enableActions
      const mask = r.readInt();
      // Stats MUST be read in ascending bit order — they're packed sequentially.
      // 0x1=skin(byte), 0x2=face(int), 0x4=hair(int), 0x10=level(byte), 0x20=job(short),
      // 0x40=str(short), 0x80=dex(short), 0x100=int(short), 0x200=luk(short),
      // 0x400=hp(short), 0x800=maxHp(short), 0x1000=mp(short), 0x2000=maxMp(short),
      // 0x4000=ap(short), 0x8000=sp(short), 0x10000=exp(int), 0x20000=fame(short),
      // 0x40000=meso(int)
      if (mask & 0x1)     r.readByte();                          // skin
      if (mask & 0x2)     r.readInt();                           // face
      if (mask & 0x4)     r.readInt();                           // hair
      if (mask & 0x10)    { this.stats.level = r.readByte(); }
      if (mask & 0x20)    { const oldJob = this.jobId; this.jobId = r.readShort(); if (this.jobId !== oldJob) this.emit('jobChanged', { jobId: this.jobId, oldJob }); }
      if (mask & 0x40)    { this.stats.str = r.readShort(); }
      if (mask & 0x80)    { this.stats.dex = r.readShort(); }
      if (mask & 0x100)   { this.stats.int = r.readShort(); }
      if (mask & 0x200)   { this.stats.luk = r.readShort(); }
      if (mask & 0x400)   { this.stats.hp = r.readShort(); }
      if (mask & 0x800)   { this.stats.maxHp = r.readShort(); }
      if (mask & 0x1000)  { this.stats.mp = r.readShort(); }
      if (mask & 0x2000)  { this.stats.maxMp = r.readShort(); }
      if (mask & 0x4000)  { this.ap = r.readShort(); this.emit('apGained', { ap: this.ap }); }
      if (mask & 0x8000)  { this.sp = r.readShort(); this.emit('spGained', { sp: this.sp }); }
      if (mask & 0x10000) { this.stats.exp = r.readInt(); }
      if (mask & 0x20000) { this.stats.fame = r.readShort(); }
      if (mask & 0x40000) { this.stats.meso = r.readInt(); }
      this.emit('statsUpdate', this.stats);
    } catch { /* partial stat update is acceptable */ }
  }

  _onSpawnNpc(payload) {
    try {
      const r = new PacketReader(payload);
      const oid = r.readInt();
      const npcId = r.readInt();
      const x = r.readShort();
      const y = r.readShort();
      this.npcsNearby.set(oid, { npcId, x, y });
      this.emit('npcSpawn', { oid, npcId, x, y });
    } catch { /* ignore */ }
  }

  _onNpcTalk(payload) {
    try {
      const r = new PacketReader(payload);
      r.skip(1); // 4 = fixed header
      const npcId = r.readInt();
      const msgType = r.readByte();
      r.skip(1); // speaker
      const text = r.readString();
      this.inNpcChat = true;
      this.emit('npcDialog', { npcId, msgType, text });
    } catch { /* ignore */ }
  }

  _onOpenShop(payload) {
    try {
      const r = new PacketReader(payload);
      const shopId = r.readInt();
      const itemCount = r.readShort();
      this.shopItems = [];
      for (let i = 0; i < itemCount && r.remaining() >= 12; i++) {
        const itemId = r.readInt();
        const price = r.readInt();
        r.skip(4); // pitch
        r.skip(4); // time limit
        r.skip(4); // unknown
        const quantity = r.remaining() >= 4 ? r.readShort() : 1;
        if (r.remaining() >= 2) r.readShort(); // max buyable
        this.shopItems.push({ slot: i, itemId, price, quantity });
      }
      this.inShop = true;
      this.emit('shopOpen', { shopId, items: this.shopItems });
    } catch { /* ignore */ }
  }

  _onShopResult(payload) {
    try {
      const r = new PacketReader(payload);
      const code = r.readByte();
      this.emit('shopResult', { code, success: code === 0 });
    } catch { /* ignore */ }
  }

  _onPartyOperation(payload) {
    try {
      const r = new PacketReader(payload);
      const op = r.readByte();
      if (op === 8) {
        // Party created
        this.partyId = r.readInt();
        this.emit('partyCreated', { partyId: this.partyId });
      } else if (op === 12) {
        // Invited to party
        const fromCharId = r.readInt();
        const fromName = r.readString();
        this.emit('partyInvite', { fromCharId, fromName });
      }
    } catch { /* ignore */ }
  }

  _onStatusInfo(payload) {
    try {
      const r = new PacketReader(payload);
      const type = r.readByte();
      if (type === 1) {
        // Quest update
        const questId = r.readShort();
        const status = r.readByte();
        const progress = r.readString();
        this.emit('questUpdate', { questId, status, progress });
      }
    } catch { /* ignore */ }
  }

  // ── Guild/Trade/Buddy/Buff/Pet server→client handlers ─────────────────

  _onGuildOperation(payload) {
    try {
      const r = new PacketReader(payload);
      const type = r.readByte();
      if (type === 0x12) { // guild info/create result
        this.guildId = r.readInt();
        this.guildName = r.readString();
        this.emit('guildUpdate', { guildId: this.guildId, guildName: this.guildName });
      } else if (type === 0x25) { // guild invite received
        const guildId = r.readInt();
        const senderName = r.readString();
        this.emit('guildInvite', { guildId, senderName });
      } else if (type === 0x2C) { // disbanded/left
        this.guildId = 0;
        this.guildName = '';
        this.emit('guildLeft', {});
      }
    } catch { /* ignore */ }
  }

  _onPlayerInteraction(payload) {
    try {
      const r = new PacketReader(payload);
      const mode = r.readByte();
      if (mode === 0x05) { // trade invite received
        const fromName = r.readString();
        this.emit('tradeInvite', { fromName });
      } else if (mode === 0x0D) { // trade started
        this.inTrade = true;
        this.emit('tradeStarted', {});
      } else if (mode === 0x0A || mode === 0x0C) { // trade ended/cancelled
        this.inTrade = false;
        this.emit('tradeEnded', { cancelled: mode === 0x0C });
      }
    } catch { /* ignore */ }
  }

  _onBuddyList(payload) {
    try {
      const r = new PacketReader(payload);
      const op = r.readByte();
      if (op === 0x07) { // buddy list update
        const count = r.readByte();
        for (let i = 0; i < count && r.remaining() >= 10; i++) {
          const charId = r.readInt();
          const name = r.readString();
          const status = r.readByte();
          const channel = r.readInt();
          const group = r.remaining() >= 2 ? r.readString() : 'Default Group';
          this.buddyList.set(charId, { name, channel: status ? channel : -1, group });
        }
        this.emit('buddyListUpdate', { buddies: [...this.buddyList.values()] });
      } else if (op === 0x09) { // buddy request received
        const charId = r.readInt();
        const name = r.readString();
        this.emit('buddyRequest', { charId, name });
      }
    } catch { /* ignore */ }
  }

  _onCancelBuff(payload) {
    try {
      const r = new PacketReader(payload);
      const charId = r.readInt();
      if (charId !== this.charId) return;
      // Buff mask removed — clear tracked buffs
      this.buffActive.clear();
      this.emit('buffRemoved', {});
    } catch { /* ignore */ }
  }

  _onSkillEffect(payload) {
    try {
      const r = new PacketReader(payload);
      const charId = r.readInt();
      const skillId = r.readInt();
      const level = r.readByte();
      if (charId === this.charId) {
        this.buffActive.add(skillId);
        this.emit('skillUsed', { skillId, level });
      }
    } catch { /* ignore */ }
  }

  _onSpawnPet(payload) {
    try {
      const r = new PacketReader(payload);
      const ownerId = r.readInt();
      const slot = r.readByte();
      if (ownerId === this.charId) {
        this.petId = slot; // track that we have a pet active
        this.emit('petSpawned', { slot });
      }
    } catch { /* ignore */ }
  }

  _onChangeChannel(payload) {
    try {
      const r = new PacketReader(payload);
      // Server sends new IP + port for the target channel
      const ipBytes = r.readBytes(4);
      const port = r.readShort();
      this.channelIp = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
      this.channelPort = port;
      // Reconnect to the new channel
      if (this.socket) this.socket.destroy();
      this.state = 'channel_connect';
      this._connectToChannel();
    } catch { /* ignore */ }
  }

  _onFameResponse(payload) {
    try {
      const r = new PacketReader(payload);
      const status = r.readByte();
      if (status === 0) {
        // Success: name, mode, newFame
        const targetName = r.readString();
        const mode = r.readByte(); // 0=down, 1=up
        const newFame = r.readShort();
        this.emit('fameGiven', { targetName, mode, newFame, success: true });
      } else if (status === 5) {
        // We received fame from someone
        const giverName = r.readString();
        const mode = r.readByte();
        this.emit('fameReceived', { giverName, mode });
      } else {
        this.emit('fameError', { status });
      }
    } catch { /* ignore */ }
  }

  _onWhisper(payload) {
    try {
      const r = new PacketReader(payload);
      const flag = r.readByte();
      if (flag === 0x12) {
        // Whisper received
        const senderName = r.readString();
        const senderChannel = r.readByte();
        const isGM = r.readByte() === 1;
        const message = r.readString();
        this.emit('whisper', { senderName, senderChannel, isGM, message });
      } else if (flag === 0x0A) {
        // Whisper send result
        const targetName = r.readString();
        const success = r.readByte() === 1;
        this.emit('whisperResult', { targetName, success });
      }
    } catch { /* ignore */ }
  }

  // ── Bot actions ─────────────────────────────────────────────────────────

  chat(message) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.GENERAL_CHAT);
    pkt.writeString(message.substring(0, 127));
    pkt.writeByte(1); // show = public
    this._sendPacket(pkt.build());
  }

  moveTo(x, y, foothold) {
    if (this.state !== 'ingame') return;
    this.x = x;
    this.y = y;
    if (foothold !== undefined) this.fh = foothold;
    const pkt = new PacketWriter(RecvOp.MOVE_PLAYER);
    pkt.writeZero(9); // portal count, timestamps
    pkt.writeByte(1); // 1 movement segment
    pkt.writeByte(0); // movement type: absolute
    pkt.writeShort(x);
    pkt.writeShort(y);
    pkt.writeShort(0); // vx
    pkt.writeShort(0); // vy
    pkt.writeShort(this.fh); // foothold — use tracked value instead of 0
    pkt.writeByte(x > this.x ? 1 : 0);  // stance: face direction of movement
    pkt.writeShort(100); // duration ~100ms for natural movement
    this._sendPacket(pkt.build());
  }

  changeMap(mapId, portalName = 'sp') {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.CHANGE_MAP);
    pkt.writeByte(0);  // cash shop = false
    pkt.writeInt(-1);  // target map (-1 = use portal)
    pkt.writeString(portalName);
    pkt.writeShort(0); // unused
    this._sendPacket(pkt.build());
  }

  /**
   * Use a portal by name: walk to its position and send the changeMap packet.
   * Returns a promise that resolves when the portal packet is sent.
   * @param {string} portalName - portal name from portals Map
   * @returns {Promise<boolean>} true if portal packet sent, false if portal not found
   */
  async usePortal(portalName) {
    if (this.state !== 'ingame') return false;
    const portal = this.portals.get(portalName);
    if (!portal) return false;
    // Walk to portal position first
    this.moveTo(portal.x, portal.y);
    // Brief delay to let server register our position
    await new Promise(r => setTimeout(r, 600));
    // Send portal change map packet
    this.changeMap(-1, portalName);
    log.info({ bot: this.name, portal: portalName, targetMap: portal.targetMap }, 'Using portal');
    return true;
  }

  /**
   * Find the nearest warp portal (type 2 = regular portal, excludes spawn points).
   * @param {number} [maxDist=Infinity] - max distance to search
   * @returns {{ name: string, x: number, y: number, targetMap: number, dist: number }|null}
   */
  getNearestPortal(maxDist = Infinity) {
    let nearest = null;
    let minDist = maxDist;
    for (const [name, p] of this.portals) {
      // type 0 = spawn point, type 1 = invisible, type 2 = regular portal
      if (p.type !== undefined && p.type === 0) continue; // skip spawn points
      if (!p.targetMap || p.targetMap <= 0) continue;      // skip no-target portals
      const dist = Math.abs(p.x - this.x) + Math.abs(p.y - this.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = { name, ...p, dist };
      }
    }
    return nearest;
  }

  /**
   * Get a random warp portal (non-spawn, has target map).
   * @returns {{ name: string, x: number, y: number, targetMap: number }|null}
   */
  getRandomPortal() {
    const warps = [];
    for (const [name, p] of this.portals) {
      if (p.type !== undefined && p.type === 0) continue;
      if (!p.targetMap || p.targetMap <= 0) continue;
      warps.push({ name, ...p });
    }
    return warps.length ? warps[Math.floor(Math.random() * warps.length)] : null;
  }

  // ── Combat actions ───────────────────────────────────────────────────

  /**
   * Melee attack a single monster. skillId=0 for normal attack.
   * @param {number} monsterOid - object ID of the monster on the map
   * @param {number} damage - damage to claim (server validates)
   * @param {number} [skillId=0] - skill ID (0 = basic attack)
   */
  attackMelee(monsterOid, damage, skillId = 0) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.CLOSE_RANGE_ATTACK);
    pkt.writeByte(0);     // padding
    // numAttackedAndDamage: upper 4 bits = targets (1), lower 4 bits = damage lines (1)
    pkt.writeByte(0x11);  // 1 target, 1 damage line
    pkt.writeInt(skillId);
    pkt.writeZero(8);     // skip bytes
    pkt.writeByte(0);     // display
    pkt.writeByte(0);     // direction
    pkt.writeByte(0);     // stance
    pkt.writeByte(0);     // padding
    pkt.writeByte(4);     // speed (attack speed, lower = faster)
    pkt.writeZero(4);     // skip

    // Target data
    pkt.writeInt(monsterOid);
    pkt.writeInt(0);      // skip
    pkt.writeShort(this.x);
    pkt.writeShort(this.y);
    pkt.writeShort(0);    // next x
    pkt.writeShort(0);    // next y
    pkt.writeShort(0);    // delay
    pkt.writeInt(damage); // damage line
    this._sendPacket(pkt.build());
  }

  /**
   * Ranged attack a single monster.
   */
  attackRanged(monsterOid, damage, skillId = 0) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.RANGED_ATTACK);
    pkt.writeByte(0);     // padding
    pkt.writeByte(0x11);  // 1 target, 1 damage line
    pkt.writeInt(skillId);
    pkt.writeZero(8);     // skip
    pkt.writeByte(0);     // display
    pkt.writeByte(0);     // direction
    pkt.writeByte(0);     // stance
    pkt.writeByte(0);     // padding
    pkt.writeByte(4);     // speed
    pkt.writeByte(0);     // padding
    pkt.writeByte(0);     // rangedirection
    pkt.writeZero(7);     // skip

    pkt.writeInt(monsterOid);
    pkt.writeInt(0);
    pkt.writeShort(this.x);
    pkt.writeShort(this.y);
    pkt.writeShort(0);
    pkt.writeShort(0);
    pkt.writeShort(0);
    pkt.writeInt(damage);
    this._sendPacket(pkt.build());
  }

  /**
   * Magic attack a single monster.
   */
  attackMagic(monsterOid, damage, skillId) {
    if (this.state !== 'ingame' || !skillId) return;
    const pkt = new PacketWriter(RecvOp.MAGIC_ATTACK);
    pkt.writeByte(0);     // padding
    pkt.writeByte(0x11);  // 1 target, 1 damage line
    pkt.writeInt(skillId);
    pkt.writeZero(8);     // skip
    pkt.writeByte(0);     // display
    pkt.writeByte(0);     // direction
    pkt.writeByte(0);     // stance
    pkt.writeByte(0);     // padding
    pkt.writeByte(4);     // speed
    pkt.writeZero(4);     // skip

    pkt.writeInt(monsterOid);
    pkt.writeInt(0);
    pkt.writeShort(this.x);
    pkt.writeShort(this.y);
    pkt.writeShort(0);
    pkt.writeShort(0);
    pkt.writeShort(0);
    pkt.writeInt(damage);
    this._sendPacket(pkt.build());
  }

  // ── Inventory actions ─────────────────────────────────────────────────

  /**
   * Pick up an item/meso drop from the map.
   * @param {number} dropOid - object ID of the drop
   */
  pickupItem(dropOid) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.ITEM_PICKUP);
    pkt.writeInt(0);      // timestamp
    pkt.writeByte(0);     // padding
    pkt.writeShort(this.x);
    pkt.writeShort(this.y);
    pkt.writeInt(dropOid);
    this._sendPacket(pkt.build());
  }

  /**
   * Use a consumable item from the USE inventory.
   * @param {number} slot - slot number in USE inventory
   * @param {number} itemId - item ID to use
   */
  useItem(slot, itemId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.USE_ITEM);
    pkt.writeInt(0);      // timestamp
    pkt.writeShort(slot);
    pkt.writeInt(itemId);
    this._sendPacket(pkt.build());
  }

  /**
   * Equip an item (move from equip inventory to equipped slot).
   * @param {number} srcSlot - source slot in equip inventory (positive)
   * @param {number} dstSlot - destination equipped slot (negative, e.g. -1 for hat)
   */
  equipItem(srcSlot, dstSlot) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.ITEM_MOVE);
    pkt.writeInt(0);      // skip 4 bytes
    pkt.writeByte(1);     // inventory type: equip
    pkt.writeShort(srcSlot);
    pkt.writeShort(dstSlot); // negative = equip slot
    pkt.writeShort(0);    // quantity (unused for equip)
    this._sendPacket(pkt.build());
  }

  /**
   * Unequip an item (move from equipped slot to inventory).
   * @param {number} equippedSlot - equipped slot (negative, e.g. -1)
   * @param {number} dstSlot - destination slot in equip inventory (positive)
   */
  unequipItem(equippedSlot, dstSlot) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.ITEM_MOVE);
    pkt.writeInt(0);
    pkt.writeByte(1);     // equip inventory
    pkt.writeShort(equippedSlot); // negative src = equipped
    pkt.writeShort(dstSlot);      // positive dst = inventory
    pkt.writeShort(0);
    this._sendPacket(pkt.build());
  }

  /**
   * Drop an item from inventory.
   * @param {number} inventoryType - 1=equip, 2=use, 3=setup, 4=etc, 5=cash
   * @param {number} slot - inventory slot
   * @param {number} quantity - how many to drop
   */
  dropItem(inventoryType, slot, quantity = 1) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.ITEM_MOVE);
    pkt.writeInt(0);
    pkt.writeByte(inventoryType);
    pkt.writeShort(slot);
    pkt.writeShort(0);    // action=0 means drop
    pkt.writeShort(quantity);
    this._sendPacket(pkt.build());
  }

  // ── NPC/Shop actions ──────────────────────────────────────────────────

  /**
   * Start conversation with an NPC.
   * @param {number} npcOid - object ID of the NPC on the map
   */
  talkToNpc(npcOid) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.NPC_TALK);
    pkt.writeInt(npcOid);
    this._sendPacket(pkt.build());
  }

  /**
   * Continue NPC dialog (select an option or advance).
   * @param {number} msgType - last message type (0, 1, or 2)
   * @param {number} action - 0=end, 1=next/yes, 0xFF=previous
   * @param {number} [selection=-1] - selection index for menus
   */
  npcChatAction(msgType, action, selection = -1) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.NPC_TALK_MORE);
    pkt.writeByte(msgType);
    pkt.writeByte(action);
    if (selection >= 0) {
      pkt.writeInt(selection);
    }
    this._sendPacket(pkt.build());
    if (action === 0) this.inNpcChat = false;
  }

  /**
   * End NPC dialog.
   */
  npcChatEnd() {
    this.npcChatAction(0, 0);
    this.inNpcChat = false;
  }

  /**
   * Buy an item from an open NPC shop.
   * @param {number} shopSlot - slot index in the shop
   * @param {number} itemId - item ID to buy
   * @param {number} quantity - how many to buy
   */
  shopBuy(shopSlot, itemId, quantity = 1) {
    if (this.state !== 'ingame' || !this.inShop) return;
    const pkt = new PacketWriter(RecvOp.NPC_SHOP);
    pkt.writeByte(0);     // mode: buy
    pkt.writeShort(shopSlot);
    pkt.writeInt(itemId);
    pkt.writeShort(quantity);
    this._sendPacket(pkt.build());
  }

  /**
   * Sell an item to an open NPC shop.
   * @param {number} slot - inventory slot of item to sell
   * @param {number} itemId - item ID
   * @param {number} quantity - how many to sell
   */
  shopSell(slot, itemId, quantity = 1) {
    if (this.state !== 'ingame' || !this.inShop) return;
    const pkt = new PacketWriter(RecvOp.NPC_SHOP);
    pkt.writeByte(1);     // mode: sell
    pkt.writeShort(slot);
    pkt.writeInt(itemId);
    pkt.writeShort(quantity);
    this._sendPacket(pkt.build());
  }

  /**
   * Leave an NPC shop.
   */
  shopLeave() {
    if (!this.inShop) return;
    const pkt = new PacketWriter(RecvOp.NPC_SHOP);
    pkt.writeByte(3);     // mode: leave
    this._sendPacket(pkt.build());
    this.inShop = false;
  }

  // ── Party actions ─────────────────────────────────────────────────────

  /**
   * Create a new party.
   */
  partyCreate() {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PARTY_OPERATION);
    pkt.writeByte(1);     // operation: create
    this._sendPacket(pkt.build());
  }

  /**
   * Leave the current party.
   */
  partyLeave() {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PARTY_OPERATION);
    pkt.writeByte(2);     // operation: leave
    this._sendPacket(pkt.build());
    this.partyId = 0;
  }

  /**
   * Join a party by ID.
   * @param {number} partyId - party to join
   */
  partyJoin(partyId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PARTY_OPERATION);
    pkt.writeByte(3);     // operation: join
    pkt.writeInt(partyId);
    this._sendPacket(pkt.build());
  }

  /**
   * Invite a player to party by name.
   * @param {string} playerName - name of player to invite
   */
  partyInvite(playerName) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PARTY_OPERATION);
    pkt.writeByte(4);     // operation: invite
    pkt.writeString(playerName);
    this._sendPacket(pkt.build());
  }

  /**
   * Expel a player from party.
   * @param {number} charId - character ID to expel
   */
  partyExpel(charId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PARTY_OPERATION);
    pkt.writeByte(5);     // operation: expel
    pkt.writeInt(charId);
    this._sendPacket(pkt.build());
  }

  // ── Quest actions ─────────────────────────────────────────────────────

  /**
   * Start a quest.
   * @param {number} questId - quest ID
   * @param {number} npcId - NPC that gives the quest
   */
  questStart(questId, npcId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.QUEST_ACTION);
    pkt.writeByte(1);     // action: start
    pkt.writeShort(questId);
    pkt.writeInt(npcId);
    this._sendPacket(pkt.build());
  }

  /**
   * Complete a quest.
   * @param {number} questId - quest ID
   * @param {number} npcId - NPC to complete with
   * @param {number} [selection=-1] - reward selection
   */
  questComplete(questId, npcId, selection = -1) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.QUEST_ACTION);
    pkt.writeByte(2);     // action: complete
    pkt.writeShort(questId);
    pkt.writeInt(npcId);
    if (selection >= 0) pkt.writeShort(selection);
    this._sendPacket(pkt.build());
  }

  /**
   * Forfeit/abandon a quest.
   * @param {number} questId - quest ID to forfeit
   */
  questForfeit(questId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.QUEST_ACTION);
    pkt.writeByte(3);     // action: forfeit
    pkt.writeShort(questId);
    this._sendPacket(pkt.build());
  }

  // ── Stat/Skill actions ────────────────────────────────────────────────

  /**
   * Distribute an ability point (AP) to a stat.
   * Stat IDs: 0x40=STR, 0x80=DEX, 0x100=INT, 0x200=LUK
   * @param {number} statId - stat to add AP to
   */
  distributeAP(statId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.DISTRIBUTE_AP);
    pkt.writeInt(0);      // timestamp
    pkt.writeInt(statId);
    this._sendPacket(pkt.build());
  }

  /**
   * Distribute a skill point (SP) to a skill.
   * @param {number} skillId - skill to level up
   */
  distributeSP(skillId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.DISTRIBUTE_SP);
    pkt.writeInt(0);      // timestamp
    pkt.writeInt(skillId);
    this._sendPacket(pkt.build());
  }

  // ── Emotes & misc ─────────────────────────────────────────────────────

  /**
   * Show a face expression/emote. Built-in emotes: 1-7.
   * @param {number} emoteId - emote ID (1-7 for built-in, 8+ need items)
   */
  emote(emoteId) {
    if (this.state !== 'ingame' || emoteId < 1) return;
    const pkt = new PacketWriter(RecvOp.FACE_EXPRESSION);
    pkt.writeInt(emoteId);
    this._sendPacket(pkt.build());
  }

  /**
   * Send passive HP/MP regen tick.
   * @param {number} hp - HP to heal (max ~150)
   * @param {number} mp - MP to heal (max ~999)
   */
  healOverTime(hp, mp) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.HEAL_OVER_TIME);
    pkt.writeZero(8);     // skip 8 bytes
    pkt.writeShort(Math.min(hp, 150));
    pkt.writeShort(Math.min(mp, 999));
    this._sendPacket(pkt.build());
  }

  // ── Guild actions ────────────────────────────────────────────────────

  /** Create a guild. Requires 50K meso + at least 5 party members online. */
  guildCreate(guildName) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.GUILD_OPERATION);
    pkt.writeByte(0x02); // type: create
    pkt.writeString(guildName);
    this._sendPacket(pkt.build());
  }

  /** Invite a player to your guild by name. */
  guildInvite(playerName) {
    if (this.state !== 'ingame' || !this.guildId) return;
    const pkt = new PacketWriter(RecvOp.GUILD_OPERATION);
    pkt.writeByte(0x05); // type: invite
    pkt.writeString(playerName);
    this._sendPacket(pkt.build());
  }

  /** Accept a guild invitation. */
  guildJoin(guildId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.GUILD_OPERATION);
    pkt.writeByte(0x06); // type: join/accept
    pkt.writeInt(guildId);
    this._sendPacket(pkt.build());
  }

  /** Leave the current guild. */
  guildLeave() {
    if (this.state !== 'ingame' || !this.guildId) return;
    const pkt = new PacketWriter(RecvOp.GUILD_OPERATION);
    pkt.writeByte(0x07); // type: leave
    pkt.writeInt(this.charId);
    pkt.writeString(this.name);
    this._sendPacket(pkt.build());
    this.guildId = 0;
    this.guildName = '';
  }

  /** Expel a member from guild. */
  guildExpel(charId, charName) {
    if (this.state !== 'ingame' || !this.guildId) return;
    const pkt = new PacketWriter(RecvOp.GUILD_OPERATION);
    pkt.writeByte(0x08); // type: expel
    pkt.writeInt(charId);
    pkt.writeString(charName);
    this._sendPacket(pkt.build());
  }

  /** Change guild notice/emblem. */
  guildNotice(notice) {
    if (this.state !== 'ingame' || !this.guildId) return;
    const pkt = new PacketWriter(RecvOp.GUILD_OPERATION);
    pkt.writeByte(0x10); // type: change notice
    pkt.writeString(notice);
    this._sendPacket(pkt.build());
  }

  // ── Trade actions ──────────────────────────────────────────────────────

  /** Create a new trade room. */
  tradeCreate() {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PLAYER_INTERACTION);
    pkt.writeByte(0x00); // mode: create
    pkt.writeByte(3);    // type: trade (3)
    this._sendPacket(pkt.build());
  }

  /** Invite a player to trade. */
  tradeInvite(charId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PLAYER_INTERACTION);
    pkt.writeByte(0x02); // mode: invite
    pkt.writeInt(charId);
    this._sendPacket(pkt.build());
  }

  /** Accept a trade invitation. */
  tradeAccept() {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PLAYER_INTERACTION);
    pkt.writeByte(0x05); // mode: visit/accept
    this._sendPacket(pkt.build());
    this.inTrade = true;
  }

  /** Set an item in trade window.
   * @param {number} inventoryType 1=equip,2=use,3=setup,4=etc,5=cash
   * @param {number} slot inventory slot
   * @param {number} quantity how many
   * @param {number} tradeSlot target trade slot (0-8)
   */
  tradeSetItem(inventoryType, slot, quantity, tradeSlot) {
    if (this.state !== 'ingame' || !this.inTrade) return;
    const pkt = new PacketWriter(RecvOp.PLAYER_INTERACTION);
    pkt.writeByte(0x0F); // mode: set items
    pkt.writeByte(inventoryType);
    pkt.writeShort(slot);
    pkt.writeShort(quantity);
    pkt.writeByte(tradeSlot);
    this._sendPacket(pkt.build());
  }

  /** Set meso amount in trade. */
  tradeSetMeso(amount) {
    if (this.state !== 'ingame' || !this.inTrade) return;
    const pkt = new PacketWriter(RecvOp.PLAYER_INTERACTION);
    pkt.writeByte(0x10); // mode: set meso
    pkt.writeInt(amount);
    this._sendPacket(pkt.build());
  }

  /** Confirm the trade. Both sides must confirm. */
  tradeConfirm() {
    if (this.state !== 'ingame' || !this.inTrade) return;
    const pkt = new PacketWriter(RecvOp.PLAYER_INTERACTION);
    pkt.writeByte(0x11); // mode: confirm
    this._sendPacket(pkt.build());
  }

  /** Exit/cancel the trade. */
  tradeExit() {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PLAYER_INTERACTION);
    pkt.writeByte(0x0A); // mode: exit
    this._sendPacket(pkt.build());
    this.inTrade = false;
  }

  // ── Buddy list actions ─────────────────────────────────────────────────

  /** Add a player to buddy list by name. */
  buddyAdd(playerName, group = 'Default Group') {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.MODIFY_BUDDY_LIST);
    pkt.writeByte(1); // mode: add
    pkt.writeString(playerName);
    pkt.writeString(group);
    this._sendPacket(pkt.build());
  }

  /** Accept a buddy request by character ID. */
  buddyAccept(charId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.MODIFY_BUDDY_LIST);
    pkt.writeByte(2); // mode: accept
    pkt.writeInt(charId);
    this._sendPacket(pkt.build());
  }

  /** Delete a buddy by character ID. */
  buddyDelete(charId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.MODIFY_BUDDY_LIST);
    pkt.writeByte(3); // mode: delete
    pkt.writeInt(charId);
    this._sendPacket(pkt.build());
    this.buddyList.delete(charId);
  }

  // ── Channel change ─────────────────────────────────────────────────────

  /** Switch to a different game channel. @param {number} channel 0-based channel index */
  changeChannel(channel) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.CHANGE_CHANNEL);
    pkt.writeByte(channel + 1); // server expects 1-based
    pkt.writeInt(Date.now() & 0x7FFFFFFF); // timestamp
    this._sendPacket(pkt.build());
  }

  // ── Skill/Buff actions ─────────────────────────────────────────────────

  /** Use a buff/skill (sends skill effect to server).
   * @param {number} skillId skill ID
   * @param {number} [level=1] skill level
   */
  useSkill(skillId, level = 1) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.SKILL_EFFECT);
    pkt.writeInt(skillId);
    pkt.writeByte(level);
    pkt.writeByte(0); // flags
    pkt.writeByte(4); // speed
    pkt.writeByte(0); // aids/targets
    this._sendPacket(pkt.build());
    this.buffActive.add(skillId);
  }

  /** Cancel an active buff. @param {number} skillId skill to cancel */
  cancelBuff(skillId) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.CANCEL_BUFF);
    pkt.writeInt(skillId);
    this._sendPacket(pkt.build());
    this.buffActive.delete(skillId);
  }

  // ── Pet actions ────────────────────────────────────────────────────────

  /** Spawn/summon a pet from cash inventory.
   * @param {number} slot cash inventory slot of the pet
   * @param {boolean} lead true if this pet should be the lead pet
   */
  spawnPet(slot, lead = true) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.SPAWN_PET);
    pkt.writeInt(0); // timestamp
    pkt.writeByte(slot);
    pkt.writeByte(0); // unknown
    pkt.writeByte(lead ? 1 : 0);
    this._sendPacket(pkt.build());
  }

  /** Send a command to an active pet.
   * @param {number} petIndex pet index (0-2)
   * @param {number} command 0=sit,1=come,2=feed,3=speak,4=rest,5=roll,6=hang,7=fly
   */
  petCommand(petIndex, command) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.PET_COMMAND);
    pkt.writeInt(petIndex);
    pkt.writeInt(0); // timestamp
    pkt.writeByte(0); // type
    pkt.writeByte(command);
    this._sendPacket(pkt.build());
  }

  // ── Megaphone / server chat ────────────────────────────────────────────

  /** Send a megaphone message (super megaphone — world broadcast).
   * Requires owning item 5072000 (Super Megaphone) in cash inventory.
   * @param {string} message broadcast message
   * @param {number} [slot=1] cash inventory slot of the megaphone item
   */
  megaphone(message, slot = 1) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.USE_CASH_ITEM);
    pkt.writeShort(slot);
    pkt.writeInt(5072000); // Super Megaphone item ID
    pkt.writeString(message.substring(0, 60));
    pkt.writeByte(1); // whisperTarget (1 = show world)
    pkt.writeByte(this.channelId);
    this._sendPacket(pkt.build());
  }

  /** Send a regular megaphone (map-wide). Item 5071000.
   * @param {string} message
   * @param {number} [slot=1] cash inventory slot
   */
  megaphoneLocal(message, slot = 1) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.USE_CASH_ITEM);
    pkt.writeShort(slot);
    pkt.writeInt(5071000); // Megaphone item ID
    pkt.writeString(message.substring(0, 60));
    this._sendPacket(pkt.build());
  }

  // ── Fame actions ─────────────────────────────────────────────────────

  /** Give fame (+1) to a player by their object ID on the map.
   * @param {number} targetOid - object ID of the target player
   * @param {boolean} [up=true] - true=+1 fame, false=-1 fame
   */
  giveFame(targetOid, up = true) {
    if (this.state !== 'ingame') return;
    if (this.stats.level < 15) return; // server requires level 15
    const pkt = new PacketWriter(RecvOp.GIVE_FAME);
    pkt.writeInt(targetOid);
    pkt.writeByte(up ? 1 : 0);
    this._sendPacket(pkt.build());
    this.lastFameTime = Date.now();
  }

  // ── Whisper/PM actions ─────────────────────────────────────────────────

  /** Send a private whisper message to a player.
   * @param {string} targetName - character name to whisper
   * @param {string} message - message (max 127 chars)
   */
  whisper(targetName, message) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.WHISPER);
    pkt.writeByte(0x06); // WHISPER | REQUEST
    pkt.writeString(targetName);
    pkt.writeString(message.substring(0, 127));
    this._sendPacket(pkt.build());
  }

  /** Find a player's location (map/channel).
   * @param {string} targetName - character name to find
   */
  findPlayer(targetName) {
    if (this.state !== 'ingame') return;
    const pkt = new PacketWriter(RecvOp.WHISPER);
    pkt.writeByte(0x05); // LOCATION | REQUEST
    pkt.writeString(targetName);
    this._sendPacket(pkt.build());
  }

  // ── Loot filter ────────────────────────────────────────────────────────

  /** Set a loot filter to control what items get picked up.
   * @param {null|Set|number[]|function} filter
   *   null = pick up everything (default)
   *   Set or Array of item IDs = only pick up these items + all meso
   *   function(itemId, isMeso) => bool = custom filter
   */
  setLootFilter(filter) {
    if (filter === null || filter === undefined) {
      this.lootFilter = null;
    } else if (typeof filter === 'function') {
      this.lootFilter = filter;
    } else if (Array.isArray(filter)) {
      this.lootFilter = new Set(filter);
    } else if (filter instanceof Set) {
      this.lootFilter = filter;
    }
  }

  /** Check if an item passes the loot filter.
   * @param {number} itemId
   * @param {boolean} isMeso
   * @returns {boolean}
   */
  shouldLoot(itemId, isMeso) {
    if (isMeso) return true; // always pick up meso
    if (!this.lootFilter) return true; // no filter = loot all
    if (typeof this.lootFilter === 'function') return this.lootFilter(itemId, isMeso);
    return this.lootFilter.has(itemId);
  }

  // ── Auto-reconnect ─────────────────────────────────────────────────────

  /** Enable auto-reconnect on disconnect.
   * @param {boolean} enabled
   * @param {number} [maxAttempts=5]
   */
  setAutoReconnect(enabled, maxAttempts = 5) {
    this._autoReconnect = enabled;
    this._maxReconnectAttempts = maxAttempts;
    this._reconnectAttempts = 0;
  }

  /** Attempt to reconnect after a disconnect. Called internally. */
  _tryReconnect() {
    if (!this._autoReconnect) return;
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      log.warn({ bot: this.name, attempts: this._reconnectAttempts }, 'Max reconnect attempts reached');
      this.emit('reconnectFailed', { attempts: this._reconnectAttempts });
      return;
    }
    this._reconnectAttempts++;
    const delay = Math.min(5000 * this._reconnectAttempts, 30000); // backoff: 5s, 10s, 15s... max 30s
    log.info({ bot: this.name, attempt: this._reconnectAttempts, delay }, 'Reconnecting...');
    this.emit('reconnecting', { attempt: this._reconnectAttempts, delay });
    setTimeout(() => {
      this.connect()
        .then(() => {
          this._reconnectAttempts = 0;
          log.info({ bot: this.name }, 'Reconnected successfully');
          this.emit('reconnected', {});
        })
        .catch(err => {
          log.error({ bot: this.name, err: err.message }, 'Reconnect failed');
          this._tryReconnect();
        });
    }, delay);
  }

  // ── State persistence helpers ──────────────────────────────────────────

  /** Export current bot state as a serializable object. */
  exportState() {
    return {
      name: this.name,
      username: this.username,
      charId: this.charId,
      mapId: this.mapId,
      x: this.x,
      y: this.y,
      channelId: this.channelId,
      stats: { ...this.stats },
      guildId: this.guildId,
      guildName: this.guildName,
      partyId: this.partyId,
      buddyList: [...this.buddyList.entries()].map(([id, b]) => ({ charId: id, ...b })),
      inventory: {
        equip: [...this.inventory.equip.entries()],
        use: [...this.inventory.use.entries()],
        setup: [...this.inventory.setup.entries()],
        etc: [...this.inventory.etc.entries()],
        cash: [...this.inventory.cash.entries()],
      },
      buffs: [...this.buffActive],
      lastFameTime: this.lastFameTime,
      savedAt: Date.now(),
    };
  }

  /** Import previously saved state. Call before connect() to seed initial values. */
  importState(state) {
    if (!state) return;
    if (state.mapId) this.mapId = state.mapId;
    if (state.x) this.x = state.x;
    if (state.y) this.y = state.y;
    if (state.channelId) this.channelId = state.channelId;
    if (state.stats) Object.assign(this.stats, state.stats);
    if (state.guildId) { this.guildId = state.guildId; this.guildName = state.guildName || ''; }
    if (state.partyId) this.partyId = state.partyId;
    if (state.buddyList) {
      for (const b of state.buddyList) {
        this.buddyList.set(b.charId, { name: b.name, channel: b.channel, group: b.group });
      }
    }
    if (state.lastFameTime) this.lastFameTime = state.lastFameTime;
    // Inventory restore
    if (state.inventory) {
      for (const [type, entries] of Object.entries(state.inventory)) {
        if (this.inventory[type] && Array.isArray(entries)) {
          for (const [slot, item] of entries) {
            this.inventory[type].set(slot, item);
          }
        }
      }
    }
  }

  // ── Convenience helpers ───────────────────────────────────────────────

  /** Get nearest monster within range. */
  getNearestMonster(maxDist = 500) {
    let nearest = null;
    let minDist = maxDist;
    for (const [oid, mob] of this.monstersNearby) {
      const dist = Math.abs(mob.x - this.x) + Math.abs(mob.y - this.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = { oid, ...mob, dist };
      }
    }
    return nearest;
  }

  /** Get nearest item drop within range. */
  getNearestDrop(maxDist = 300) {
    let nearest = null;
    let minDist = maxDist;
    for (const [oid, drop] of this.dropsNearby) {
      const dist = Math.abs(drop.x - this.x) + Math.abs(drop.y - this.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = { oid, ...drop, dist };
      }
    }
    return nearest;
  }

  /** Clear map state (monsters, drops, NPCs) — called on map change. */
  _clearMapState() {
    this.monstersNearby.clear();
    this.dropsNearby.clear();
    this.npcsNearby.clear();
    this.playersNearby.clear();
    this.portals.clear();
    this.inNpcChat = false;
    if (this.inShop) { this.inShop = false; this.shopItems = []; }
    if (this.inTrade) { this.inTrade = false; }
  }

  /** Get nearest NPC within range. */
  getNearestNpc(maxDist = 300) {
    let nearest = null;
    let minDist = maxDist;
    for (const [oid, npc] of this.npcsNearby) {
      const dist = Math.abs(npc.x - this.x) + Math.abs(npc.y - this.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = { oid, ...npc, dist };
      }
    }
    return nearest;
  }
}

export default MapleBot;
