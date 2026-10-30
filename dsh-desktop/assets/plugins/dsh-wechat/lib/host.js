import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "../node_modules/qrcode/lib/can-promise.js"(exports, module) {
    module.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// ../node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "../node_modules/qrcode/lib/core/utils.js"(exports) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    };
    exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    };
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    };
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = function toSJIS(kanji) {
      return toSJISFunction(kanji);
    };
  }
});

// ../node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "../node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    exports.isValid = function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    };
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "../node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    BitBuffer.prototype = {
      get: function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      },
      put: function(num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) === 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module.exports = BitBuffer;
  }
});

// ../node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "../node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module.exports = BitMatrix;
  }
});

// ../node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "../node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i = 1; i < posCount - 1; i++) {
        positions[i] = positions[i - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    };
    exports.getPositions = function getPositions(version) {
      const coords = [];
      const pos = exports.getRowColCoords(version);
      const posLength = pos.length;
      for (let i = 0; i < posLength; i++) {
        for (let j = 0; j < posLength; j++) {
          if (i === 0 && j === 0 || // top-left
          i === 0 && j === posLength - 1 || // bottom-left
          i === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i], pos[j]]);
        }
      }
      return coords;
    };
  }
});

// ../node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "../node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    };
  }
});

// ../node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "../node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    };
    exports.from = function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    };
    exports.getPenaltyN1 = function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module2 = data.get(row, col);
          if (module2 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module2;
            sameCountCol = 1;
          }
          module2 = data.get(col, row);
          if (module2 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module2;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    };
    exports.getPenaltyN2 = function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    };
    exports.getPenaltyN3 = function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    };
    exports.getPenaltyN4 = function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    };
    function getMaskAt(maskPattern, i, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    exports.applyMask = function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    };
    exports.getBestMask = function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    };
  }
});

// ../node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "../node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
  }
});

// ../node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "../node_modules/qrcode/lib/core/galois-field.js"(exports) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (function initTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = x;
        LOG_TABLE[x] = i;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i = 255; i < 512; i++) {
        EXP_TABLE[i] = EXP_TABLE[i - 255];
      }
    })();
    exports.log = function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    };
    exports.exp = function exp(n) {
      return EXP_TABLE[n];
    };
    exports.mul = function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    };
  }
});

// ../node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "../node_modules/qrcode/lib/core/polynomial.js"(exports) {
    var GF = require_galois_field();
    exports.mul = function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        }
      }
      return coeff;
    };
    exports.mod = function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= GF.mul(divisor[i], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    };
    exports.generateECPolynomial = function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
      }
      return poly;
    };
  }
});

// ../node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "../node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    };
    ReedSolomonEncoder.prototype.encode = function encode(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    };
    module.exports = ReedSolomonEncoder;
  }
});

// ../node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "../node_modules/qrcode/lib/core/version-check.js"(exports) {
    exports.isValid = function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    };
  }
});

// ../node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "../node_modules/qrcode/lib/core/regex.js"(exports) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = function testKanji(str) {
      return TEST_KANJI.test(str);
    };
    exports.testNumeric = function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    };
    exports.testAlphanumeric = function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    };
  }
});

// ../node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "../node_modules/qrcode/lib/core/mode.js"(exports) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    };
    exports.getBestModeForData = function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    };
    exports.toString = function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    };
    exports.isValid = function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "../node_modules/qrcode/lib/core/version.js"(exports) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    exports.from = function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    };
    exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    };
    exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    };
    exports.getEncodedBits = function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    };
  }
});

// ../node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "../node_modules/qrcode/lib/core/format-info.js"(exports) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    };
  }
});

// ../node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "../node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    NumericData.getBitsLength = function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    };
    NumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    NumericData.prototype.getBitsLength = function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    };
    NumericData.prototype.write = function write(bitBuffer) {
      let i, group, value;
      for (i = 0; i + 3 <= this.data.length; i += 3) {
        group = this.data.substr(i, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i;
      if (remainingNum > 0) {
        group = this.data.substr(i);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    };
    module.exports = NumericData;
  }
});

// ../node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "../node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    AlphanumericData.getBitsLength = function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    };
    AlphanumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    AlphanumericData.prototype.getBitsLength = function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    };
    AlphanumericData.prototype.write = function write(bitBuffer) {
      let i;
      for (i = 0; i + 2 <= this.data.length; i += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      }
    };
    module.exports = AlphanumericData;
  }
});

// ../node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "../node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    ByteData.getBitsLength = function getBitsLength(length) {
      return length * 8;
    };
    ByteData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    ByteData.prototype.getBitsLength = function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    };
    ByteData.prototype.write = function(bitBuffer) {
      for (let i = 0, l = this.data.length; i < l; i++) {
        bitBuffer.put(this.data[i], 8);
      }
    };
    module.exports = ByteData;
  }
});

// ../node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "../node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    KanjiData.getBitsLength = function getBitsLength(length) {
      return length * 13;
    };
    KanjiData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    KanjiData.prototype.getBitsLength = function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    };
    KanjiData.prototype.write = function(bitBuffer) {
      let i;
      for (i = 0; i < this.data.length; i++) {
        let value = Utils.toSJIS(this.data[i]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module.exports = KanjiData;
  }
});

// ../node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "../node_modules/dijkstrajs/dijkstra.js"(exports, module) {
    "use strict";
    var dijkstra = {
      single_source_shortest_paths: function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      },
      extract_shortest_path_from_predecessor_list: function(predecessors, d) {
        var nodes = [];
        var u = d;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      },
      find_path: function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      },
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        },
        default_sorter: function(a, b) {
          return a.cost - b.cost;
        },
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        },
        /**
         * Return the highest priority element in the queue.
         */
        pop: function() {
          return this.queue.shift();
        },
        empty: function() {
          return this.queue.length === 0;
        }
      }
    };
    if (typeof module !== "undefined") {
      module.exports = dijkstra;
    }
  }
});

// ../node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "../node_modules/qrcode/lib/core/segments.js"(exports) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    function buildNodes(segs) {
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i = 0; i < nodes.length; i++) {
        const nodeGroup = nodes[i];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    exports.fromArray = function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    };
    exports.fromString = function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i = 1; i < path.length - 1; i++) {
        optimizedSegs.push(graph.table[path[i]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    };
    exports.rawSplit = function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    };
  }
});

// ../node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "../node_modules/qrcode/lib/core/qrcode.js"(exports) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version);
      let row, col, mod;
      for (let i = 0; i < 18; i++) {
        row = Math.floor(i / 3);
        col = i % 3 + size - 8 - 3;
        mod = (bits >> i & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i, mod;
      for (i = 0; i < 15; i++) {
        mod = (bits >> i & 1) === 1;
        if (i < 6) {
          matrix.set(i, 8, mod, true);
        } else if (i < 8) {
          matrix.set(i + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i, 8, mod, true);
        }
        if (i < 8) {
          matrix.set(8, size - i - 1, mod, true);
        } else if (i < 9) {
          matrix.set(8, 15 - i - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i = 0; i < remainingByte; i++) {
        buffer.put(i % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i, r;
      for (i = 0; i < maxDataSize; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i < dcData[r].length) {
            data[index++] = dcData[r][i];
          }
        }
      }
      for (i = 0; i < ecCount; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i];
        }
      }
      return data;
    }
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    exports.create = function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    };
  }
});

// ../node_modules/pngjs/lib/chunkstream.js
var require_chunkstream = __commonJS({
  "../node_modules/pngjs/lib/chunkstream.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var Stream = __require("stream");
    var ChunkStream = module.exports = function() {
      Stream.call(this);
      this._buffers = [];
      this._buffered = 0;
      this._reads = [];
      this._paused = false;
      this._encoding = "utf8";
      this.writable = true;
    };
    util.inherits(ChunkStream, Stream);
    ChunkStream.prototype.read = function(length, callback) {
      this._reads.push({
        length: Math.abs(length),
        // if length < 0 then at most this length
        allowLess: length < 0,
        func: callback
      });
      process.nextTick(
        function() {
          this._process();
          if (this._paused && this._reads && this._reads.length > 0) {
            this._paused = false;
            this.emit("drain");
          }
        }.bind(this)
      );
    };
    ChunkStream.prototype.write = function(data, encoding) {
      if (!this.writable) {
        this.emit("error", new Error("Stream not writable"));
        return false;
      }
      let dataBuffer;
      if (Buffer.isBuffer(data)) {
        dataBuffer = data;
      } else {
        dataBuffer = Buffer.from(data, encoding || this._encoding);
      }
      this._buffers.push(dataBuffer);
      this._buffered += dataBuffer.length;
      this._process();
      if (this._reads && this._reads.length === 0) {
        this._paused = true;
      }
      return this.writable && !this._paused;
    };
    ChunkStream.prototype.end = function(data, encoding) {
      if (data) {
        this.write(data, encoding);
      }
      this.writable = false;
      if (!this._buffers) {
        return;
      }
      if (this._buffers.length === 0) {
        this._end();
      } else {
        this._buffers.push(null);
        this._process();
      }
    };
    ChunkStream.prototype.destroySoon = ChunkStream.prototype.end;
    ChunkStream.prototype._end = function() {
      if (this._reads.length > 0) {
        this.emit("error", new Error("Unexpected end of input"));
      }
      this.destroy();
    };
    ChunkStream.prototype.destroy = function() {
      if (!this._buffers) {
        return;
      }
      this.writable = false;
      this._reads = null;
      this._buffers = null;
      this.emit("close");
    };
    ChunkStream.prototype._processReadAllowingLess = function(read) {
      this._reads.shift();
      let smallerBuf = this._buffers[0];
      if (smallerBuf.length > read.length) {
        this._buffered -= read.length;
        this._buffers[0] = smallerBuf.slice(read.length);
        read.func.call(this, smallerBuf.slice(0, read.length));
      } else {
        this._buffered -= smallerBuf.length;
        this._buffers.shift();
        read.func.call(this, smallerBuf);
      }
    };
    ChunkStream.prototype._processRead = function(read) {
      this._reads.shift();
      let pos = 0;
      let count = 0;
      let data = Buffer.alloc(read.length);
      while (pos < read.length) {
        let buf = this._buffers[count++];
        let len = Math.min(buf.length, read.length - pos);
        buf.copy(data, pos, 0, len);
        pos += len;
        if (len !== buf.length) {
          this._buffers[--count] = buf.slice(len);
        }
      }
      if (count > 0) {
        this._buffers.splice(0, count);
      }
      this._buffered -= read.length;
      read.func.call(this, data);
    };
    ChunkStream.prototype._process = function() {
      try {
        while (this._buffered > 0 && this._reads && this._reads.length > 0) {
          let read = this._reads[0];
          if (read.allowLess) {
            this._processReadAllowingLess(read);
          } else if (this._buffered >= read.length) {
            this._processRead(read);
          } else {
            break;
          }
        }
        if (this._buffers && !this.writable) {
          this._end();
        }
      } catch (ex) {
        this.emit("error", ex);
      }
    };
  }
});

// ../node_modules/pngjs/lib/interlace.js
var require_interlace = __commonJS({
  "../node_modules/pngjs/lib/interlace.js"(exports) {
    "use strict";
    var imagePasses = [
      {
        // pass 1 - 1px
        x: [0],
        y: [0]
      },
      {
        // pass 2 - 1px
        x: [4],
        y: [0]
      },
      {
        // pass 3 - 2px
        x: [0, 4],
        y: [4]
      },
      {
        // pass 4 - 4px
        x: [2, 6],
        y: [0, 4]
      },
      {
        // pass 5 - 8px
        x: [0, 2, 4, 6],
        y: [2, 6]
      },
      {
        // pass 6 - 16px
        x: [1, 3, 5, 7],
        y: [0, 2, 4, 6]
      },
      {
        // pass 7 - 32px
        x: [0, 1, 2, 3, 4, 5, 6, 7],
        y: [1, 3, 5, 7]
      }
    ];
    exports.getImagePasses = function(width, height) {
      let images = [];
      let xLeftOver = width % 8;
      let yLeftOver = height % 8;
      let xRepeats = (width - xLeftOver) / 8;
      let yRepeats = (height - yLeftOver) / 8;
      for (let i = 0; i < imagePasses.length; i++) {
        let pass = imagePasses[i];
        let passWidth = xRepeats * pass.x.length;
        let passHeight = yRepeats * pass.y.length;
        for (let j = 0; j < pass.x.length; j++) {
          if (pass.x[j] < xLeftOver) {
            passWidth++;
          } else {
            break;
          }
        }
        for (let j = 0; j < pass.y.length; j++) {
          if (pass.y[j] < yLeftOver) {
            passHeight++;
          } else {
            break;
          }
        }
        if (passWidth > 0 && passHeight > 0) {
          images.push({ width: passWidth, height: passHeight, index: i });
        }
      }
      return images;
    };
    exports.getInterlaceIterator = function(width) {
      return function(x, y, pass) {
        let outerXLeftOver = x % imagePasses[pass].x.length;
        let outerX = (x - outerXLeftOver) / imagePasses[pass].x.length * 8 + imagePasses[pass].x[outerXLeftOver];
        let outerYLeftOver = y % imagePasses[pass].y.length;
        let outerY = (y - outerYLeftOver) / imagePasses[pass].y.length * 8 + imagePasses[pass].y[outerYLeftOver];
        return outerX * 4 + outerY * width * 4;
      };
    };
  }
});

// ../node_modules/pngjs/lib/paeth-predictor.js
var require_paeth_predictor = __commonJS({
  "../node_modules/pngjs/lib/paeth-predictor.js"(exports, module) {
    "use strict";
    module.exports = function paethPredictor(left, above, upLeft) {
      let paeth = left + above - upLeft;
      let pLeft = Math.abs(paeth - left);
      let pAbove = Math.abs(paeth - above);
      let pUpLeft = Math.abs(paeth - upLeft);
      if (pLeft <= pAbove && pLeft <= pUpLeft) {
        return left;
      }
      if (pAbove <= pUpLeft) {
        return above;
      }
      return upLeft;
    };
  }
});

// ../node_modules/pngjs/lib/filter-parse.js
var require_filter_parse = __commonJS({
  "../node_modules/pngjs/lib/filter-parse.js"(exports, module) {
    "use strict";
    var interlaceUtils = require_interlace();
    var paethPredictor = require_paeth_predictor();
    function getByteWidth(width, bpp, depth) {
      let byteWidth = width * bpp;
      if (depth !== 8) {
        byteWidth = Math.ceil(byteWidth / (8 / depth));
      }
      return byteWidth;
    }
    var Filter = module.exports = function(bitmapInfo, dependencies) {
      let width = bitmapInfo.width;
      let height = bitmapInfo.height;
      let interlace = bitmapInfo.interlace;
      let bpp = bitmapInfo.bpp;
      let depth = bitmapInfo.depth;
      this.read = dependencies.read;
      this.write = dependencies.write;
      this.complete = dependencies.complete;
      this._imageIndex = 0;
      this._images = [];
      if (interlace) {
        let passes = interlaceUtils.getImagePasses(width, height);
        for (let i = 0; i < passes.length; i++) {
          this._images.push({
            byteWidth: getByteWidth(passes[i].width, bpp, depth),
            height: passes[i].height,
            lineIndex: 0
          });
        }
      } else {
        this._images.push({
          byteWidth: getByteWidth(width, bpp, depth),
          height,
          lineIndex: 0
        });
      }
      if (depth === 8) {
        this._xComparison = bpp;
      } else if (depth === 16) {
        this._xComparison = bpp * 2;
      } else {
        this._xComparison = 1;
      }
    };
    Filter.prototype.start = function() {
      this.read(
        this._images[this._imageIndex].byteWidth + 1,
        this._reverseFilterLine.bind(this)
      );
    };
    Filter.prototype._unFilterType1 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f1Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        unfilteredLine[x] = rawByte + f1Left;
      }
    };
    Filter.prototype._unFilterType2 = function(rawData, unfilteredLine, byteWidth) {
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f2Up = lastLine ? lastLine[x] : 0;
        unfilteredLine[x] = rawByte + f2Up;
      }
    };
    Filter.prototype._unFilterType3 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f3Up = lastLine ? lastLine[x] : 0;
        let f3Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        let f3Add = Math.floor((f3Left + f3Up) / 2);
        unfilteredLine[x] = rawByte + f3Add;
      }
    };
    Filter.prototype._unFilterType4 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f4Up = lastLine ? lastLine[x] : 0;
        let f4Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        let f4UpLeft = x > xBiggerThan && lastLine ? lastLine[x - xComparison] : 0;
        let f4Add = paethPredictor(f4Left, f4Up, f4UpLeft);
        unfilteredLine[x] = rawByte + f4Add;
      }
    };
    Filter.prototype._reverseFilterLine = function(rawData) {
      let filter = rawData[0];
      let unfilteredLine;
      let currentImage = this._images[this._imageIndex];
      let byteWidth = currentImage.byteWidth;
      if (filter === 0) {
        unfilteredLine = rawData.slice(1, byteWidth + 1);
      } else {
        unfilteredLine = Buffer.alloc(byteWidth);
        switch (filter) {
          case 1:
            this._unFilterType1(rawData, unfilteredLine, byteWidth);
            break;
          case 2:
            this._unFilterType2(rawData, unfilteredLine, byteWidth);
            break;
          case 3:
            this._unFilterType3(rawData, unfilteredLine, byteWidth);
            break;
          case 4:
            this._unFilterType4(rawData, unfilteredLine, byteWidth);
            break;
          default:
            throw new Error("Unrecognised filter type - " + filter);
        }
      }
      this.write(unfilteredLine);
      currentImage.lineIndex++;
      if (currentImage.lineIndex >= currentImage.height) {
        this._lastLine = null;
        this._imageIndex++;
        currentImage = this._images[this._imageIndex];
      } else {
        this._lastLine = unfilteredLine;
      }
      if (currentImage) {
        this.read(currentImage.byteWidth + 1, this._reverseFilterLine.bind(this));
      } else {
        this._lastLine = null;
        this.complete();
      }
    };
  }
});

// ../node_modules/pngjs/lib/filter-parse-async.js
var require_filter_parse_async = __commonJS({
  "../node_modules/pngjs/lib/filter-parse-async.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var ChunkStream = require_chunkstream();
    var Filter = require_filter_parse();
    var FilterAsync = module.exports = function(bitmapInfo) {
      ChunkStream.call(this);
      let buffers = [];
      let that = this;
      this._filter = new Filter(bitmapInfo, {
        read: this.read.bind(this),
        write: function(buffer) {
          buffers.push(buffer);
        },
        complete: function() {
          that.emit("complete", Buffer.concat(buffers));
        }
      });
      this._filter.start();
    };
    util.inherits(FilterAsync, ChunkStream);
  }
});

// ../node_modules/pngjs/lib/constants.js
var require_constants = __commonJS({
  "../node_modules/pngjs/lib/constants.js"(exports, module) {
    "use strict";
    module.exports = {
      PNG_SIGNATURE: [137, 80, 78, 71, 13, 10, 26, 10],
      TYPE_IHDR: 1229472850,
      TYPE_IEND: 1229278788,
      TYPE_IDAT: 1229209940,
      TYPE_PLTE: 1347179589,
      TYPE_tRNS: 1951551059,
      // eslint-disable-line camelcase
      TYPE_gAMA: 1732332865,
      // eslint-disable-line camelcase
      // color-type bits
      COLORTYPE_GRAYSCALE: 0,
      COLORTYPE_PALETTE: 1,
      COLORTYPE_COLOR: 2,
      COLORTYPE_ALPHA: 4,
      // e.g. grayscale and alpha
      // color-type combinations
      COLORTYPE_PALETTE_COLOR: 3,
      COLORTYPE_COLOR_ALPHA: 6,
      COLORTYPE_TO_BPP_MAP: {
        0: 1,
        2: 3,
        3: 1,
        4: 2,
        6: 4
      },
      GAMMA_DIVISION: 1e5
    };
  }
});

// ../node_modules/pngjs/lib/crc.js
var require_crc = __commonJS({
  "../node_modules/pngjs/lib/crc.js"(exports, module) {
    "use strict";
    var crcTable = [];
    (function() {
      for (let i = 0; i < 256; i++) {
        let currentCrc = i;
        for (let j = 0; j < 8; j++) {
          if (currentCrc & 1) {
            currentCrc = 3988292384 ^ currentCrc >>> 1;
          } else {
            currentCrc = currentCrc >>> 1;
          }
        }
        crcTable[i] = currentCrc;
      }
    })();
    var CrcCalculator = module.exports = function() {
      this._crc = -1;
    };
    CrcCalculator.prototype.write = function(data) {
      for (let i = 0; i < data.length; i++) {
        this._crc = crcTable[(this._crc ^ data[i]) & 255] ^ this._crc >>> 8;
      }
      return true;
    };
    CrcCalculator.prototype.crc32 = function() {
      return this._crc ^ -1;
    };
    CrcCalculator.crc32 = function(buf) {
      let crc = -1;
      for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 255] ^ crc >>> 8;
      }
      return crc ^ -1;
    };
  }
});

// ../node_modules/pngjs/lib/parser.js
var require_parser = __commonJS({
  "../node_modules/pngjs/lib/parser.js"(exports, module) {
    "use strict";
    var constants = require_constants();
    var CrcCalculator = require_crc();
    var Parser = module.exports = function(options, dependencies) {
      this._options = options;
      options.checkCRC = options.checkCRC !== false;
      this._hasIHDR = false;
      this._hasIEND = false;
      this._emittedHeadersFinished = false;
      this._palette = [];
      this._colorType = 0;
      this._chunks = {};
      this._chunks[constants.TYPE_IHDR] = this._handleIHDR.bind(this);
      this._chunks[constants.TYPE_IEND] = this._handleIEND.bind(this);
      this._chunks[constants.TYPE_IDAT] = this._handleIDAT.bind(this);
      this._chunks[constants.TYPE_PLTE] = this._handlePLTE.bind(this);
      this._chunks[constants.TYPE_tRNS] = this._handleTRNS.bind(this);
      this._chunks[constants.TYPE_gAMA] = this._handleGAMA.bind(this);
      this.read = dependencies.read;
      this.error = dependencies.error;
      this.metadata = dependencies.metadata;
      this.gamma = dependencies.gamma;
      this.transColor = dependencies.transColor;
      this.palette = dependencies.palette;
      this.parsed = dependencies.parsed;
      this.inflateData = dependencies.inflateData;
      this.finished = dependencies.finished;
      this.simpleTransparency = dependencies.simpleTransparency;
      this.headersFinished = dependencies.headersFinished || function() {
      };
    };
    Parser.prototype.start = function() {
      this.read(constants.PNG_SIGNATURE.length, this._parseSignature.bind(this));
    };
    Parser.prototype._parseSignature = function(data) {
      let signature = constants.PNG_SIGNATURE;
      for (let i = 0; i < signature.length; i++) {
        if (data[i] !== signature[i]) {
          this.error(new Error("Invalid file signature"));
          return;
        }
      }
      this.read(8, this._parseChunkBegin.bind(this));
    };
    Parser.prototype._parseChunkBegin = function(data) {
      let length = data.readUInt32BE(0);
      let type = data.readUInt32BE(4);
      let name2 = "";
      for (let i = 4; i < 8; i++) {
        name2 += String.fromCharCode(data[i]);
      }
      let ancillary = Boolean(data[4] & 32);
      if (!this._hasIHDR && type !== constants.TYPE_IHDR) {
        this.error(new Error("Expected IHDR on beggining"));
        return;
      }
      this._crc = new CrcCalculator();
      this._crc.write(Buffer.from(name2));
      if (this._chunks[type]) {
        return this._chunks[type](length);
      }
      if (!ancillary) {
        this.error(new Error("Unsupported critical chunk type " + name2));
        return;
      }
      this.read(length + 4, this._skipChunk.bind(this));
    };
    Parser.prototype._skipChunk = function() {
      this.read(8, this._parseChunkBegin.bind(this));
    };
    Parser.prototype._handleChunkEnd = function() {
      this.read(4, this._parseChunkEnd.bind(this));
    };
    Parser.prototype._parseChunkEnd = function(data) {
      let fileCrc = data.readInt32BE(0);
      let calcCrc = this._crc.crc32();
      if (this._options.checkCRC && calcCrc !== fileCrc) {
        this.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
        return;
      }
      if (!this._hasIEND) {
        this.read(8, this._parseChunkBegin.bind(this));
      }
    };
    Parser.prototype._handleIHDR = function(length) {
      this.read(length, this._parseIHDR.bind(this));
    };
    Parser.prototype._parseIHDR = function(data) {
      this._crc.write(data);
      let width = data.readUInt32BE(0);
      let height = data.readUInt32BE(4);
      let depth = data[8];
      let colorType = data[9];
      let compr = data[10];
      let filter = data[11];
      let interlace = data[12];
      if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) {
        this.error(new Error("Unsupported bit depth " + depth));
        return;
      }
      if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) {
        this.error(new Error("Unsupported color type"));
        return;
      }
      if (compr !== 0) {
        this.error(new Error("Unsupported compression method"));
        return;
      }
      if (filter !== 0) {
        this.error(new Error("Unsupported filter method"));
        return;
      }
      if (interlace !== 0 && interlace !== 1) {
        this.error(new Error("Unsupported interlace method"));
        return;
      }
      this._colorType = colorType;
      let bpp = constants.COLORTYPE_TO_BPP_MAP[this._colorType];
      this._hasIHDR = true;
      this.metadata({
        width,
        height,
        depth,
        interlace: Boolean(interlace),
        palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
        color: Boolean(colorType & constants.COLORTYPE_COLOR),
        alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
        bpp,
        colorType
      });
      this._handleChunkEnd();
    };
    Parser.prototype._handlePLTE = function(length) {
      this.read(length, this._parsePLTE.bind(this));
    };
    Parser.prototype._parsePLTE = function(data) {
      this._crc.write(data);
      let entries = Math.floor(data.length / 3);
      for (let i = 0; i < entries; i++) {
        this._palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255]);
      }
      this.palette(this._palette);
      this._handleChunkEnd();
    };
    Parser.prototype._handleTRNS = function(length) {
      this.simpleTransparency();
      this.read(length, this._parseTRNS.bind(this));
    };
    Parser.prototype._parseTRNS = function(data) {
      this._crc.write(data);
      if (this._colorType === constants.COLORTYPE_PALETTE_COLOR) {
        if (this._palette.length === 0) {
          this.error(new Error("Transparency chunk must be after palette"));
          return;
        }
        if (data.length > this._palette.length) {
          this.error(new Error("More transparent colors than palette size"));
          return;
        }
        for (let i = 0; i < data.length; i++) {
          this._palette[i][3] = data[i];
        }
        this.palette(this._palette);
      }
      if (this._colorType === constants.COLORTYPE_GRAYSCALE) {
        this.transColor([data.readUInt16BE(0)]);
      }
      if (this._colorType === constants.COLORTYPE_COLOR) {
        this.transColor([
          data.readUInt16BE(0),
          data.readUInt16BE(2),
          data.readUInt16BE(4)
        ]);
      }
      this._handleChunkEnd();
    };
    Parser.prototype._handleGAMA = function(length) {
      this.read(length, this._parseGAMA.bind(this));
    };
    Parser.prototype._parseGAMA = function(data) {
      this._crc.write(data);
      this.gamma(data.readUInt32BE(0) / constants.GAMMA_DIVISION);
      this._handleChunkEnd();
    };
    Parser.prototype._handleIDAT = function(length) {
      if (!this._emittedHeadersFinished) {
        this._emittedHeadersFinished = true;
        this.headersFinished();
      }
      this.read(-length, this._parseIDAT.bind(this, length));
    };
    Parser.prototype._parseIDAT = function(length, data) {
      this._crc.write(data);
      if (this._colorType === constants.COLORTYPE_PALETTE_COLOR && this._palette.length === 0) {
        throw new Error("Expected palette not found");
      }
      this.inflateData(data);
      let leftOverLength = length - data.length;
      if (leftOverLength > 0) {
        this._handleIDAT(leftOverLength);
      } else {
        this._handleChunkEnd();
      }
    };
    Parser.prototype._handleIEND = function(length) {
      this.read(length, this._parseIEND.bind(this));
    };
    Parser.prototype._parseIEND = function(data) {
      this._crc.write(data);
      this._hasIEND = true;
      this._handleChunkEnd();
      if (this.finished) {
        this.finished();
      }
    };
  }
});

// ../node_modules/pngjs/lib/bitmapper.js
var require_bitmapper = __commonJS({
  "../node_modules/pngjs/lib/bitmapper.js"(exports) {
    "use strict";
    var interlaceUtils = require_interlace();
    var pixelBppMapper = [
      // 0 - dummy entry
      function() {
      },
      // 1 - L
      // 0: 0, 1: 0, 2: 0, 3: 0xff
      function(pxData, data, pxPos, rawPos) {
        if (rawPos === data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = 255;
      },
      // 2 - LA
      // 0: 0, 1: 0, 2: 0, 3: 1
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 1 >= data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = data[rawPos + 1];
      },
      // 3 - RGB
      // 0: 0, 1: 1, 2: 2, 3: 0xff
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 2 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = 255;
      },
      // 4 - RGBA
      // 0: 0, 1: 1, 2: 2, 3: 3
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 3 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = data[rawPos + 3];
      }
    ];
    var pixelBppCustomMapper = [
      // 0 - dummy entry
      function() {
      },
      // 1 - L
      // 0: 0, 1: 0, 2: 0, 3: 0xff
      function(pxData, pixelData, pxPos, maxBit) {
        let pixel = pixelData[0];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = maxBit;
      },
      // 2 - LA
      // 0: 0, 1: 0, 2: 0, 3: 1
      function(pxData, pixelData, pxPos) {
        let pixel = pixelData[0];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = pixelData[1];
      },
      // 3 - RGB
      // 0: 0, 1: 1, 2: 2, 3: 0xff
      function(pxData, pixelData, pxPos, maxBit) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = maxBit;
      },
      // 4 - RGBA
      // 0: 0, 1: 1, 2: 2, 3: 3
      function(pxData, pixelData, pxPos) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = pixelData[3];
      }
    ];
    function bitRetriever(data, depth) {
      let leftOver = [];
      let i = 0;
      function split() {
        if (i === data.length) {
          throw new Error("Ran out of data");
        }
        let byte = data[i];
        i++;
        let byte8, byte7, byte6, byte5, byte4, byte3, byte2, byte1;
        switch (depth) {
          default:
            throw new Error("unrecognised depth");
          case 16:
            byte2 = data[i];
            i++;
            leftOver.push((byte << 8) + byte2);
            break;
          case 4:
            byte2 = byte & 15;
            byte1 = byte >> 4;
            leftOver.push(byte1, byte2);
            break;
          case 2:
            byte4 = byte & 3;
            byte3 = byte >> 2 & 3;
            byte2 = byte >> 4 & 3;
            byte1 = byte >> 6 & 3;
            leftOver.push(byte1, byte2, byte3, byte4);
            break;
          case 1:
            byte8 = byte & 1;
            byte7 = byte >> 1 & 1;
            byte6 = byte >> 2 & 1;
            byte5 = byte >> 3 & 1;
            byte4 = byte >> 4 & 1;
            byte3 = byte >> 5 & 1;
            byte2 = byte >> 6 & 1;
            byte1 = byte >> 7 & 1;
            leftOver.push(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
            break;
        }
      }
      return {
        get: function(count) {
          while (leftOver.length < count) {
            split();
          }
          let returner = leftOver.slice(0, count);
          leftOver = leftOver.slice(count);
          return returner;
        },
        resetAfterLine: function() {
          leftOver.length = 0;
        },
        end: function() {
          if (i !== data.length) {
            throw new Error("extra data found");
          }
        }
      };
    }
    function mapImage8Bit(image, pxData, getPxPos, bpp, data, rawPos) {
      let imageWidth = image.width;
      let imageHeight = image.height;
      let imagePass = image.index;
      for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
          let pxPos = getPxPos(x, y, imagePass);
          pixelBppMapper[bpp](pxData, data, pxPos, rawPos);
          rawPos += bpp;
        }
      }
      return rawPos;
    }
    function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
      let imageWidth = image.width;
      let imageHeight = image.height;
      let imagePass = image.index;
      for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
          let pixelData = bits.get(bpp);
          let pxPos = getPxPos(x, y, imagePass);
          pixelBppCustomMapper[bpp](pxData, pixelData, pxPos, maxBit);
        }
        bits.resetAfterLine();
      }
    }
    exports.dataToBitMap = function(data, bitmapInfo) {
      let width = bitmapInfo.width;
      let height = bitmapInfo.height;
      let depth = bitmapInfo.depth;
      let bpp = bitmapInfo.bpp;
      let interlace = bitmapInfo.interlace;
      let bits;
      if (depth !== 8) {
        bits = bitRetriever(data, depth);
      }
      let pxData;
      if (depth <= 8) {
        pxData = Buffer.alloc(width * height * 4);
      } else {
        pxData = new Uint16Array(width * height * 4);
      }
      let maxBit = Math.pow(2, depth) - 1;
      let rawPos = 0;
      let images;
      let getPxPos;
      if (interlace) {
        images = interlaceUtils.getImagePasses(width, height);
        getPxPos = interlaceUtils.getInterlaceIterator(width, height);
      } else {
        let nonInterlacedPxPos = 0;
        getPxPos = function() {
          let returner = nonInterlacedPxPos;
          nonInterlacedPxPos += 4;
          return returner;
        };
        images = [{ width, height }];
      }
      for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
        if (depth === 8) {
          rawPos = mapImage8Bit(
            images[imageIndex],
            pxData,
            getPxPos,
            bpp,
            data,
            rawPos
          );
        } else {
          mapImageCustomBit(
            images[imageIndex],
            pxData,
            getPxPos,
            bpp,
            bits,
            maxBit
          );
        }
      }
      if (depth === 8) {
        if (rawPos !== data.length) {
          throw new Error("extra data found");
        }
      } else {
        bits.end();
      }
      return pxData;
    };
  }
});

// ../node_modules/pngjs/lib/format-normaliser.js
var require_format_normaliser = __commonJS({
  "../node_modules/pngjs/lib/format-normaliser.js"(exports, module) {
    "use strict";
    function dePalette(indata, outdata, width, height, palette) {
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let color = palette[indata[pxPos]];
          if (!color) {
            throw new Error("index " + indata[pxPos] + " not in palette");
          }
          for (let i = 0; i < 4; i++) {
            outdata[pxPos + i] = color[i];
          }
          pxPos += 4;
        }
      }
    }
    function replaceTransparentColor(indata, outdata, width, height, transColor) {
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let makeTrans = false;
          if (transColor.length === 1) {
            if (transColor[0] === indata[pxPos]) {
              makeTrans = true;
            }
          } else if (transColor[0] === indata[pxPos] && transColor[1] === indata[pxPos + 1] && transColor[2] === indata[pxPos + 2]) {
            makeTrans = true;
          }
          if (makeTrans) {
            for (let i = 0; i < 4; i++) {
              outdata[pxPos + i] = 0;
            }
          }
          pxPos += 4;
        }
      }
    }
    function scaleDepth(indata, outdata, width, height, depth) {
      let maxOutSample = 255;
      let maxInSample = Math.pow(2, depth) - 1;
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          for (let i = 0; i < 4; i++) {
            outdata[pxPos + i] = Math.floor(
              indata[pxPos + i] * maxOutSample / maxInSample + 0.5
            );
          }
          pxPos += 4;
        }
      }
    }
    module.exports = function(indata, imageData) {
      let depth = imageData.depth;
      let width = imageData.width;
      let height = imageData.height;
      let colorType = imageData.colorType;
      let transColor = imageData.transColor;
      let palette = imageData.palette;
      let outdata = indata;
      if (colorType === 3) {
        dePalette(indata, outdata, width, height, palette);
      } else {
        if (transColor) {
          replaceTransparentColor(indata, outdata, width, height, transColor);
        }
        if (depth !== 8) {
          if (depth === 16) {
            outdata = Buffer.alloc(width * height * 4);
          }
          scaleDepth(indata, outdata, width, height, depth);
        }
      }
      return outdata;
    };
  }
});

// ../node_modules/pngjs/lib/parser-async.js
var require_parser_async = __commonJS({
  "../node_modules/pngjs/lib/parser-async.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var zlib = __require("zlib");
    var ChunkStream = require_chunkstream();
    var FilterAsync = require_filter_parse_async();
    var Parser = require_parser();
    var bitmapper = require_bitmapper();
    var formatNormaliser = require_format_normaliser();
    var ParserAsync = module.exports = function(options) {
      ChunkStream.call(this);
      this._parser = new Parser(options, {
        read: this.read.bind(this),
        error: this._handleError.bind(this),
        metadata: this._handleMetaData.bind(this),
        gamma: this.emit.bind(this, "gamma"),
        palette: this._handlePalette.bind(this),
        transColor: this._handleTransColor.bind(this),
        finished: this._finished.bind(this),
        inflateData: this._inflateData.bind(this),
        simpleTransparency: this._simpleTransparency.bind(this),
        headersFinished: this._headersFinished.bind(this)
      });
      this._options = options;
      this.writable = true;
      this._parser.start();
    };
    util.inherits(ParserAsync, ChunkStream);
    ParserAsync.prototype._handleError = function(err) {
      this.emit("error", err);
      this.writable = false;
      this.destroy();
      if (this._inflate && this._inflate.destroy) {
        this._inflate.destroy();
      }
      if (this._filter) {
        this._filter.destroy();
        this._filter.on("error", function() {
        });
      }
      this.errord = true;
    };
    ParserAsync.prototype._inflateData = function(data) {
      if (!this._inflate) {
        if (this._bitmapInfo.interlace) {
          this._inflate = zlib.createInflate();
          this._inflate.on("error", this.emit.bind(this, "error"));
          this._filter.on("complete", this._complete.bind(this));
          this._inflate.pipe(this._filter);
        } else {
          let rowSize = (this._bitmapInfo.width * this._bitmapInfo.bpp * this._bitmapInfo.depth + 7 >> 3) + 1;
          let imageSize = rowSize * this._bitmapInfo.height;
          let chunkSize = Math.max(imageSize, zlib.Z_MIN_CHUNK);
          this._inflate = zlib.createInflate({ chunkSize });
          let leftToInflate = imageSize;
          let emitError = this.emit.bind(this, "error");
          this._inflate.on("error", function(err) {
            if (!leftToInflate) {
              return;
            }
            emitError(err);
          });
          this._filter.on("complete", this._complete.bind(this));
          let filterWrite = this._filter.write.bind(this._filter);
          this._inflate.on("data", function(chunk) {
            if (!leftToInflate) {
              return;
            }
            if (chunk.length > leftToInflate) {
              chunk = chunk.slice(0, leftToInflate);
            }
            leftToInflate -= chunk.length;
            filterWrite(chunk);
          });
          this._inflate.on("end", this._filter.end.bind(this._filter));
        }
      }
      this._inflate.write(data);
    };
    ParserAsync.prototype._handleMetaData = function(metaData) {
      this._metaData = metaData;
      this._bitmapInfo = Object.create(metaData);
      this._filter = new FilterAsync(this._bitmapInfo);
    };
    ParserAsync.prototype._handleTransColor = function(transColor) {
      this._bitmapInfo.transColor = transColor;
    };
    ParserAsync.prototype._handlePalette = function(palette) {
      this._bitmapInfo.palette = palette;
    };
    ParserAsync.prototype._simpleTransparency = function() {
      this._metaData.alpha = true;
    };
    ParserAsync.prototype._headersFinished = function() {
      this.emit("metadata", this._metaData);
    };
    ParserAsync.prototype._finished = function() {
      if (this.errord) {
        return;
      }
      if (!this._inflate) {
        this.emit("error", "No Inflate block");
      } else {
        this._inflate.end();
      }
    };
    ParserAsync.prototype._complete = function(filteredData) {
      if (this.errord) {
        return;
      }
      let normalisedBitmapData;
      try {
        let bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);
        normalisedBitmapData = formatNormaliser(bitmapData, this._bitmapInfo);
        bitmapData = null;
      } catch (ex) {
        this._handleError(ex);
        return;
      }
      this.emit("parsed", normalisedBitmapData);
    };
  }
});

// ../node_modules/pngjs/lib/bitpacker.js
var require_bitpacker = __commonJS({
  "../node_modules/pngjs/lib/bitpacker.js"(exports, module) {
    "use strict";
    var constants = require_constants();
    module.exports = function(dataIn, width, height, options) {
      let outHasAlpha = [constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA].indexOf(
        options.colorType
      ) !== -1;
      if (options.colorType === options.inputColorType) {
        let bigEndian = (function() {
          let buffer = new ArrayBuffer(2);
          new DataView(buffer).setInt16(
            0,
            256,
            true
            /* littleEndian */
          );
          return new Int16Array(buffer)[0] !== 256;
        })();
        if (options.bitDepth === 8 || options.bitDepth === 16 && bigEndian) {
          return dataIn;
        }
      }
      let data = options.bitDepth !== 16 ? dataIn : new Uint16Array(dataIn.buffer);
      let maxValue = 255;
      let inBpp = constants.COLORTYPE_TO_BPP_MAP[options.inputColorType];
      if (inBpp === 4 && !options.inputHasAlpha) {
        inBpp = 3;
      }
      let outBpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];
      if (options.bitDepth === 16) {
        maxValue = 65535;
        outBpp *= 2;
      }
      let outData = Buffer.alloc(width * height * outBpp);
      let inIndex = 0;
      let outIndex = 0;
      let bgColor = options.bgColor || {};
      if (bgColor.red === void 0) {
        bgColor.red = maxValue;
      }
      if (bgColor.green === void 0) {
        bgColor.green = maxValue;
      }
      if (bgColor.blue === void 0) {
        bgColor.blue = maxValue;
      }
      function getRGBA() {
        let red;
        let green;
        let blue;
        let alpha = maxValue;
        switch (options.inputColorType) {
          case constants.COLORTYPE_COLOR_ALPHA:
            alpha = data[inIndex + 3];
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
          case constants.COLORTYPE_COLOR:
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
          case constants.COLORTYPE_ALPHA:
            alpha = data[inIndex + 1];
            red = data[inIndex];
            green = red;
            blue = red;
            break;
          case constants.COLORTYPE_GRAYSCALE:
            red = data[inIndex];
            green = red;
            blue = red;
            break;
          default:
            throw new Error(
              "input color type:" + options.inputColorType + " is not supported at present"
            );
        }
        if (options.inputHasAlpha) {
          if (!outHasAlpha) {
            alpha /= maxValue;
            red = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.red + alpha * red), 0),
              maxValue
            );
            green = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.green + alpha * green), 0),
              maxValue
            );
            blue = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.blue + alpha * blue), 0),
              maxValue
            );
          }
        }
        return { red, green, blue, alpha };
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let rgba = getRGBA(data, inIndex);
          switch (options.colorType) {
            case constants.COLORTYPE_COLOR_ALPHA:
            case constants.COLORTYPE_COLOR:
              if (options.bitDepth === 8) {
                outData[outIndex] = rgba.red;
                outData[outIndex + 1] = rgba.green;
                outData[outIndex + 2] = rgba.blue;
                if (outHasAlpha) {
                  outData[outIndex + 3] = rgba.alpha;
                }
              } else {
                outData.writeUInt16BE(rgba.red, outIndex);
                outData.writeUInt16BE(rgba.green, outIndex + 2);
                outData.writeUInt16BE(rgba.blue, outIndex + 4);
                if (outHasAlpha) {
                  outData.writeUInt16BE(rgba.alpha, outIndex + 6);
                }
              }
              break;
            case constants.COLORTYPE_ALPHA:
            case constants.COLORTYPE_GRAYSCALE: {
              let grayscale = (rgba.red + rgba.green + rgba.blue) / 3;
              if (options.bitDepth === 8) {
                outData[outIndex] = grayscale;
                if (outHasAlpha) {
                  outData[outIndex + 1] = rgba.alpha;
                }
              } else {
                outData.writeUInt16BE(grayscale, outIndex);
                if (outHasAlpha) {
                  outData.writeUInt16BE(rgba.alpha, outIndex + 2);
                }
              }
              break;
            }
            default:
              throw new Error("unrecognised color Type " + options.colorType);
          }
          inIndex += inBpp;
          outIndex += outBpp;
        }
      }
      return outData;
    };
  }
});

// ../node_modules/pngjs/lib/filter-pack.js
var require_filter_pack = __commonJS({
  "../node_modules/pngjs/lib/filter-pack.js"(exports, module) {
    "use strict";
    var paethPredictor = require_paeth_predictor();
    function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
      for (let x = 0; x < byteWidth; x++) {
        rawData[rawPos + x] = pxData[pxPos + x];
      }
    }
    function filterSumNone(pxData, pxPos, byteWidth) {
      let sum = 0;
      let length = pxPos + byteWidth;
      for (let i = pxPos; i < length; i++) {
        sum += Math.abs(pxData[i]);
      }
      return sum;
    }
    function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;
        rawData[rawPos + x] = val;
      }
    }
    function filterSumSub(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
      for (let x = 0; x < byteWidth; x++) {
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - up;
        rawData[rawPos + x] = val;
      }
    }
    function filterSumUp(pxData, pxPos, byteWidth) {
      let sum = 0;
      let length = pxPos + byteWidth;
      for (let x = pxPos; x < length; x++) {
        let up = pxPos > 0 ? pxData[x - byteWidth] : 0;
        let val = pxData[x] - up;
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);
        rawData[rawPos + x] = val;
      }
    }
    function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
        rawData[rawPos + x] = val;
      }
    }
    function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
        sum += Math.abs(val);
      }
      return sum;
    }
    var filters = {
      0: filterNone,
      1: filterSub,
      2: filterUp,
      3: filterAvg,
      4: filterPaeth
    };
    var filterSums = {
      0: filterSumNone,
      1: filterSumSub,
      2: filterSumUp,
      3: filterSumAvg,
      4: filterSumPaeth
    };
    module.exports = function(pxData, width, height, options, bpp) {
      let filterTypes;
      if (!("filterType" in options) || options.filterType === -1) {
        filterTypes = [0, 1, 2, 3, 4];
      } else if (typeof options.filterType === "number") {
        filterTypes = [options.filterType];
      } else {
        throw new Error("unrecognised filter types");
      }
      if (options.bitDepth === 16) {
        bpp *= 2;
      }
      let byteWidth = width * bpp;
      let rawPos = 0;
      let pxPos = 0;
      let rawData = Buffer.alloc((byteWidth + 1) * height);
      let sel = filterTypes[0];
      for (let y = 0; y < height; y++) {
        if (filterTypes.length > 1) {
          let min = Infinity;
          for (let i = 0; i < filterTypes.length; i++) {
            let sum = filterSums[filterTypes[i]](pxData, pxPos, byteWidth, bpp);
            if (sum < min) {
              sel = filterTypes[i];
              min = sum;
            }
          }
        }
        rawData[rawPos] = sel;
        rawPos++;
        filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
        rawPos += byteWidth;
        pxPos += byteWidth;
      }
      return rawData;
    };
  }
});

// ../node_modules/pngjs/lib/packer.js
var require_packer = __commonJS({
  "../node_modules/pngjs/lib/packer.js"(exports, module) {
    "use strict";
    var constants = require_constants();
    var CrcStream = require_crc();
    var bitPacker = require_bitpacker();
    var filter = require_filter_pack();
    var zlib = __require("zlib");
    var Packer = module.exports = function(options) {
      this._options = options;
      options.deflateChunkSize = options.deflateChunkSize || 32 * 1024;
      options.deflateLevel = options.deflateLevel != null ? options.deflateLevel : 9;
      options.deflateStrategy = options.deflateStrategy != null ? options.deflateStrategy : 3;
      options.inputHasAlpha = options.inputHasAlpha != null ? options.inputHasAlpha : true;
      options.deflateFactory = options.deflateFactory || zlib.createDeflate;
      options.bitDepth = options.bitDepth || 8;
      options.colorType = typeof options.colorType === "number" ? options.colorType : constants.COLORTYPE_COLOR_ALPHA;
      options.inputColorType = typeof options.inputColorType === "number" ? options.inputColorType : constants.COLORTYPE_COLOR_ALPHA;
      if ([
        constants.COLORTYPE_GRAYSCALE,
        constants.COLORTYPE_COLOR,
        constants.COLORTYPE_COLOR_ALPHA,
        constants.COLORTYPE_ALPHA
      ].indexOf(options.colorType) === -1) {
        throw new Error(
          "option color type:" + options.colorType + " is not supported at present"
        );
      }
      if ([
        constants.COLORTYPE_GRAYSCALE,
        constants.COLORTYPE_COLOR,
        constants.COLORTYPE_COLOR_ALPHA,
        constants.COLORTYPE_ALPHA
      ].indexOf(options.inputColorType) === -1) {
        throw new Error(
          "option input color type:" + options.inputColorType + " is not supported at present"
        );
      }
      if (options.bitDepth !== 8 && options.bitDepth !== 16) {
        throw new Error(
          "option bit depth:" + options.bitDepth + " is not supported at present"
        );
      }
    };
    Packer.prototype.getDeflateOptions = function() {
      return {
        chunkSize: this._options.deflateChunkSize,
        level: this._options.deflateLevel,
        strategy: this._options.deflateStrategy
      };
    };
    Packer.prototype.createDeflate = function() {
      return this._options.deflateFactory(this.getDeflateOptions());
    };
    Packer.prototype.filterData = function(data, width, height) {
      let packedData = bitPacker(data, width, height, this._options);
      let bpp = constants.COLORTYPE_TO_BPP_MAP[this._options.colorType];
      let filteredData = filter(packedData, width, height, this._options, bpp);
      return filteredData;
    };
    Packer.prototype._packChunk = function(type, data) {
      let len = data ? data.length : 0;
      let buf = Buffer.alloc(len + 12);
      buf.writeUInt32BE(len, 0);
      buf.writeUInt32BE(type, 4);
      if (data) {
        data.copy(buf, 8);
      }
      buf.writeInt32BE(
        CrcStream.crc32(buf.slice(4, buf.length - 4)),
        buf.length - 4
      );
      return buf;
    };
    Packer.prototype.packGAMA = function(gamma) {
      let buf = Buffer.alloc(4);
      buf.writeUInt32BE(Math.floor(gamma * constants.GAMMA_DIVISION), 0);
      return this._packChunk(constants.TYPE_gAMA, buf);
    };
    Packer.prototype.packIHDR = function(width, height) {
      let buf = Buffer.alloc(13);
      buf.writeUInt32BE(width, 0);
      buf.writeUInt32BE(height, 4);
      buf[8] = this._options.bitDepth;
      buf[9] = this._options.colorType;
      buf[10] = 0;
      buf[11] = 0;
      buf[12] = 0;
      return this._packChunk(constants.TYPE_IHDR, buf);
    };
    Packer.prototype.packIDAT = function(data) {
      return this._packChunk(constants.TYPE_IDAT, data);
    };
    Packer.prototype.packIEND = function() {
      return this._packChunk(constants.TYPE_IEND, null);
    };
  }
});

// ../node_modules/pngjs/lib/packer-async.js
var require_packer_async = __commonJS({
  "../node_modules/pngjs/lib/packer-async.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var Stream = __require("stream");
    var constants = require_constants();
    var Packer = require_packer();
    var PackerAsync = module.exports = function(opt) {
      Stream.call(this);
      let options = opt || {};
      this._packer = new Packer(options);
      this._deflate = this._packer.createDeflate();
      this.readable = true;
    };
    util.inherits(PackerAsync, Stream);
    PackerAsync.prototype.pack = function(data, width, height, gamma) {
      this.emit("data", Buffer.from(constants.PNG_SIGNATURE));
      this.emit("data", this._packer.packIHDR(width, height));
      if (gamma) {
        this.emit("data", this._packer.packGAMA(gamma));
      }
      let filteredData = this._packer.filterData(data, width, height);
      this._deflate.on("error", this.emit.bind(this, "error"));
      this._deflate.on(
        "data",
        function(compressedData) {
          this.emit("data", this._packer.packIDAT(compressedData));
        }.bind(this)
      );
      this._deflate.on(
        "end",
        function() {
          this.emit("data", this._packer.packIEND());
          this.emit("end");
        }.bind(this)
      );
      this._deflate.end(filteredData);
    };
  }
});

// ../node_modules/pngjs/lib/sync-inflate.js
var require_sync_inflate = __commonJS({
  "../node_modules/pngjs/lib/sync-inflate.js"(exports, module) {
    "use strict";
    var assert = __require("assert").ok;
    var zlib = __require("zlib");
    var util = __require("util");
    var kMaxLength = __require("buffer").kMaxLength;
    function Inflate(opts) {
      if (!(this instanceof Inflate)) {
        return new Inflate(opts);
      }
      if (opts && opts.chunkSize < zlib.Z_MIN_CHUNK) {
        opts.chunkSize = zlib.Z_MIN_CHUNK;
      }
      zlib.Inflate.call(this, opts);
      this._offset = this._offset === void 0 ? this._outOffset : this._offset;
      this._buffer = this._buffer || this._outBuffer;
      if (opts && opts.maxLength != null) {
        this._maxLength = opts.maxLength;
      }
    }
    function createInflate(opts) {
      return new Inflate(opts);
    }
    function _close(engine, callback) {
      if (callback) {
        process.nextTick(callback);
      }
      if (!engine._handle) {
        return;
      }
      engine._handle.close();
      engine._handle = null;
    }
    Inflate.prototype._processChunk = function(chunk, flushFlag, asyncCb) {
      if (typeof asyncCb === "function") {
        return zlib.Inflate._processChunk.call(this, chunk, flushFlag, asyncCb);
      }
      let self = this;
      let availInBefore = chunk && chunk.length;
      let availOutBefore = this._chunkSize - this._offset;
      let leftToInflate = this._maxLength;
      let inOff = 0;
      let buffers = [];
      let nread = 0;
      let error;
      this.on("error", function(err) {
        error = err;
      });
      function handleChunk(availInAfter, availOutAfter) {
        if (self._hadError) {
          return;
        }
        let have = availOutBefore - availOutAfter;
        assert(have >= 0, "have should not go down");
        if (have > 0) {
          let out = self._buffer.slice(self._offset, self._offset + have);
          self._offset += have;
          if (out.length > leftToInflate) {
            out = out.slice(0, leftToInflate);
          }
          buffers.push(out);
          nread += out.length;
          leftToInflate -= out.length;
          if (leftToInflate === 0) {
            return false;
          }
        }
        if (availOutAfter === 0 || self._offset >= self._chunkSize) {
          availOutBefore = self._chunkSize;
          self._offset = 0;
          self._buffer = Buffer.allocUnsafe(self._chunkSize);
        }
        if (availOutAfter === 0) {
          inOff += availInBefore - availInAfter;
          availInBefore = availInAfter;
          return true;
        }
        return false;
      }
      assert(this._handle, "zlib binding closed");
      let res;
      do {
        res = this._handle.writeSync(
          flushFlag,
          chunk,
          // in
          inOff,
          // in_off
          availInBefore,
          // in_len
          this._buffer,
          // out
          this._offset,
          //out_off
          availOutBefore
        );
        res = res || this._writeState;
      } while (!this._hadError && handleChunk(res[0], res[1]));
      if (this._hadError) {
        throw error;
      }
      if (nread >= kMaxLength) {
        _close(this);
        throw new RangeError(
          "Cannot create final Buffer. It would be larger than 0x" + kMaxLength.toString(16) + " bytes"
        );
      }
      let buf = Buffer.concat(buffers, nread);
      _close(this);
      return buf;
    };
    util.inherits(Inflate, zlib.Inflate);
    function zlibBufferSync(engine, buffer) {
      if (typeof buffer === "string") {
        buffer = Buffer.from(buffer);
      }
      if (!(buffer instanceof Buffer)) {
        throw new TypeError("Not a string or buffer");
      }
      let flushFlag = engine._finishFlushFlag;
      if (flushFlag == null) {
        flushFlag = zlib.Z_FINISH;
      }
      return engine._processChunk(buffer, flushFlag);
    }
    function inflateSync(buffer, opts) {
      return zlibBufferSync(new Inflate(opts), buffer);
    }
    module.exports = exports = inflateSync;
    exports.Inflate = Inflate;
    exports.createInflate = createInflate;
    exports.inflateSync = inflateSync;
  }
});

// ../node_modules/pngjs/lib/sync-reader.js
var require_sync_reader = __commonJS({
  "../node_modules/pngjs/lib/sync-reader.js"(exports, module) {
    "use strict";
    var SyncReader = module.exports = function(buffer) {
      this._buffer = buffer;
      this._reads = [];
    };
    SyncReader.prototype.read = function(length, callback) {
      this._reads.push({
        length: Math.abs(length),
        // if length < 0 then at most this length
        allowLess: length < 0,
        func: callback
      });
    };
    SyncReader.prototype.process = function() {
      while (this._reads.length > 0 && this._buffer.length) {
        let read = this._reads[0];
        if (this._buffer.length && (this._buffer.length >= read.length || read.allowLess)) {
          this._reads.shift();
          let buf = this._buffer;
          this._buffer = buf.slice(read.length);
          read.func.call(this, buf.slice(0, read.length));
        } else {
          break;
        }
      }
      if (this._reads.length > 0) {
        return new Error("There are some read requests waitng on finished stream");
      }
      if (this._buffer.length > 0) {
        return new Error("unrecognised content at end of stream");
      }
    };
  }
});

// ../node_modules/pngjs/lib/filter-parse-sync.js
var require_filter_parse_sync = __commonJS({
  "../node_modules/pngjs/lib/filter-parse-sync.js"(exports) {
    "use strict";
    var SyncReader = require_sync_reader();
    var Filter = require_filter_parse();
    exports.process = function(inBuffer, bitmapInfo) {
      let outBuffers = [];
      let reader = new SyncReader(inBuffer);
      let filter = new Filter(bitmapInfo, {
        read: reader.read.bind(reader),
        write: function(bufferPart) {
          outBuffers.push(bufferPart);
        },
        complete: function() {
        }
      });
      filter.start();
      reader.process();
      return Buffer.concat(outBuffers);
    };
  }
});

// ../node_modules/pngjs/lib/parser-sync.js
var require_parser_sync = __commonJS({
  "../node_modules/pngjs/lib/parser-sync.js"(exports, module) {
    "use strict";
    var hasSyncZlib = true;
    var zlib = __require("zlib");
    var inflateSync = require_sync_inflate();
    if (!zlib.deflateSync) {
      hasSyncZlib = false;
    }
    var SyncReader = require_sync_reader();
    var FilterSync = require_filter_parse_sync();
    var Parser = require_parser();
    var bitmapper = require_bitmapper();
    var formatNormaliser = require_format_normaliser();
    module.exports = function(buffer, options) {
      if (!hasSyncZlib) {
        throw new Error(
          "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
        );
      }
      let err;
      function handleError(_err_) {
        err = _err_;
      }
      let metaData;
      function handleMetaData(_metaData_) {
        metaData = _metaData_;
      }
      function handleTransColor(transColor) {
        metaData.transColor = transColor;
      }
      function handlePalette(palette) {
        metaData.palette = palette;
      }
      function handleSimpleTransparency() {
        metaData.alpha = true;
      }
      let gamma;
      function handleGamma(_gamma_) {
        gamma = _gamma_;
      }
      let inflateDataList = [];
      function handleInflateData(inflatedData2) {
        inflateDataList.push(inflatedData2);
      }
      let reader = new SyncReader(buffer);
      let parser = new Parser(options, {
        read: reader.read.bind(reader),
        error: handleError,
        metadata: handleMetaData,
        gamma: handleGamma,
        palette: handlePalette,
        transColor: handleTransColor,
        inflateData: handleInflateData,
        simpleTransparency: handleSimpleTransparency
      });
      parser.start();
      reader.process();
      if (err) {
        throw err;
      }
      let inflateData = Buffer.concat(inflateDataList);
      inflateDataList.length = 0;
      let inflatedData;
      if (metaData.interlace) {
        inflatedData = zlib.inflateSync(inflateData);
      } else {
        let rowSize = (metaData.width * metaData.bpp * metaData.depth + 7 >> 3) + 1;
        let imageSize = rowSize * metaData.height;
        inflatedData = inflateSync(inflateData, {
          chunkSize: imageSize,
          maxLength: imageSize
        });
      }
      inflateData = null;
      if (!inflatedData || !inflatedData.length) {
        throw new Error("bad png - invalid inflate data response");
      }
      let unfilteredData = FilterSync.process(inflatedData, metaData);
      inflateData = null;
      let bitmapData = bitmapper.dataToBitMap(unfilteredData, metaData);
      unfilteredData = null;
      let normalisedBitmapData = formatNormaliser(bitmapData, metaData);
      metaData.data = normalisedBitmapData;
      metaData.gamma = gamma || 0;
      return metaData;
    };
  }
});

// ../node_modules/pngjs/lib/packer-sync.js
var require_packer_sync = __commonJS({
  "../node_modules/pngjs/lib/packer-sync.js"(exports, module) {
    "use strict";
    var hasSyncZlib = true;
    var zlib = __require("zlib");
    if (!zlib.deflateSync) {
      hasSyncZlib = false;
    }
    var constants = require_constants();
    var Packer = require_packer();
    module.exports = function(metaData, opt) {
      if (!hasSyncZlib) {
        throw new Error(
          "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
        );
      }
      let options = opt || {};
      let packer = new Packer(options);
      let chunks = [];
      chunks.push(Buffer.from(constants.PNG_SIGNATURE));
      chunks.push(packer.packIHDR(metaData.width, metaData.height));
      if (metaData.gamma) {
        chunks.push(packer.packGAMA(metaData.gamma));
      }
      let filteredData = packer.filterData(
        metaData.data,
        metaData.width,
        metaData.height
      );
      let compressedData = zlib.deflateSync(
        filteredData,
        packer.getDeflateOptions()
      );
      filteredData = null;
      if (!compressedData || !compressedData.length) {
        throw new Error("bad png - invalid compressed data response");
      }
      chunks.push(packer.packIDAT(compressedData));
      chunks.push(packer.packIEND());
      return Buffer.concat(chunks);
    };
  }
});

// ../node_modules/pngjs/lib/png-sync.js
var require_png_sync = __commonJS({
  "../node_modules/pngjs/lib/png-sync.js"(exports) {
    "use strict";
    var parse = require_parser_sync();
    var pack = require_packer_sync();
    exports.read = function(buffer, options) {
      return parse(buffer, options || {});
    };
    exports.write = function(png, options) {
      return pack(png, options);
    };
  }
});

// ../node_modules/pngjs/lib/png.js
var require_png = __commonJS({
  "../node_modules/pngjs/lib/png.js"(exports) {
    "use strict";
    var util = __require("util");
    var Stream = __require("stream");
    var Parser = require_parser_async();
    var Packer = require_packer_async();
    var PNGSync = require_png_sync();
    var PNG = exports.PNG = function(options) {
      Stream.call(this);
      options = options || {};
      this.width = options.width | 0;
      this.height = options.height | 0;
      this.data = this.width > 0 && this.height > 0 ? Buffer.alloc(4 * this.width * this.height) : null;
      if (options.fill && this.data) {
        this.data.fill(0);
      }
      this.gamma = 0;
      this.readable = this.writable = true;
      this._parser = new Parser(options);
      this._parser.on("error", this.emit.bind(this, "error"));
      this._parser.on("close", this._handleClose.bind(this));
      this._parser.on("metadata", this._metadata.bind(this));
      this._parser.on("gamma", this._gamma.bind(this));
      this._parser.on(
        "parsed",
        function(data) {
          this.data = data;
          this.emit("parsed", data);
        }.bind(this)
      );
      this._packer = new Packer(options);
      this._packer.on("data", this.emit.bind(this, "data"));
      this._packer.on("end", this.emit.bind(this, "end"));
      this._parser.on("close", this._handleClose.bind(this));
      this._packer.on("error", this.emit.bind(this, "error"));
    };
    util.inherits(PNG, Stream);
    PNG.sync = PNGSync;
    PNG.prototype.pack = function() {
      if (!this.data || !this.data.length) {
        this.emit("error", "No data provided");
        return this;
      }
      process.nextTick(
        function() {
          this._packer.pack(this.data, this.width, this.height, this.gamma);
        }.bind(this)
      );
      return this;
    };
    PNG.prototype.parse = function(data, callback) {
      if (callback) {
        let onParsed, onError;
        onParsed = function(parsedData) {
          this.removeListener("error", onError);
          this.data = parsedData;
          callback(null, this);
        }.bind(this);
        onError = function(err) {
          this.removeListener("parsed", onParsed);
          callback(err, null);
        }.bind(this);
        this.once("parsed", onParsed);
        this.once("error", onError);
      }
      this.end(data);
      return this;
    };
    PNG.prototype.write = function(data) {
      this._parser.write(data);
      return true;
    };
    PNG.prototype.end = function(data) {
      this._parser.end(data);
    };
    PNG.prototype._metadata = function(metadata) {
      this.width = metadata.width;
      this.height = metadata.height;
      this.emit("metadata", metadata);
    };
    PNG.prototype._gamma = function(gamma) {
      this.gamma = gamma;
    };
    PNG.prototype._handleClose = function() {
      if (!this._parser.writable && !this._packer.readable) {
        this.emit("close");
      }
    };
    PNG.bitblt = function(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
      srcX |= 0;
      srcY |= 0;
      width |= 0;
      height |= 0;
      deltaX |= 0;
      deltaY |= 0;
      if (srcX > src.width || srcY > src.height || srcX + width > src.width || srcY + height > src.height) {
        throw new Error("bitblt reading outside image");
      }
      if (deltaX > dst.width || deltaY > dst.height || deltaX + width > dst.width || deltaY + height > dst.height) {
        throw new Error("bitblt writing outside image");
      }
      for (let y = 0; y < height; y++) {
        src.data.copy(
          dst.data,
          (deltaY + y) * dst.width + deltaX << 2,
          (srcY + y) * src.width + srcX << 2,
          (srcY + y) * src.width + srcX + width << 2
        );
      }
    };
    PNG.prototype.bitblt = function(dst, srcX, srcY, width, height, deltaX, deltaY) {
      PNG.bitblt(this, dst, srcX, srcY, width, height, deltaX, deltaY);
      return this;
    };
    PNG.adjustGamma = function(src) {
      if (src.gamma) {
        for (let y = 0; y < src.height; y++) {
          for (let x = 0; x < src.width; x++) {
            let idx = src.width * y + x << 2;
            for (let i = 0; i < 3; i++) {
              let sample = src.data[idx + i] / 255;
              sample = Math.pow(sample, 1 / 2.2 / src.gamma);
              src.data[idx + i] = Math.round(sample * 255);
            }
          }
        }
        src.gamma = 0;
      }
    };
    PNG.prototype.adjustGamma = function() {
      PNG.adjustGamma(this);
    };
  }
});

// ../node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "../node_modules/qrcode/lib/renderer/utils.js"(exports) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    exports.getOptions = function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    };
    exports.getScale = function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    };
    exports.getImageWidth = function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    };
    exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i = 0; i < symbolSize; i++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    };
  }
});

// ../node_modules/qrcode/lib/renderer/png.js
var require_png2 = __commonJS({
  "../node_modules/qrcode/lib/renderer/png.js"(exports) {
    var fs = __require("fs");
    var PNG = require_png().PNG;
    var Utils = require_utils2();
    exports.render = function render(qrData, options) {
      const opts = Utils.getOptions(options);
      const pngOpts = opts.rendererOpts;
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      pngOpts.width = size;
      pngOpts.height = size;
      const pngImage = new PNG(pngOpts);
      Utils.qrToImageData(pngImage.data, qrData, opts);
      return pngImage;
    };
    exports.renderToDataURL = function renderToDataURL(qrData, options, cb) {
      if (typeof cb === "undefined") {
        cb = options;
        options = void 0;
      }
      exports.renderToBuffer(qrData, options, function(err, output) {
        if (err) cb(err);
        let url = "data:image/png;base64,";
        url += output.toString("base64");
        cb(null, url);
      });
    };
    exports.renderToBuffer = function renderToBuffer(qrData, options, cb) {
      if (typeof cb === "undefined") {
        cb = options;
        options = void 0;
      }
      const png = exports.render(qrData, options);
      const buffer = [];
      png.on("error", cb);
      png.on("data", function(data) {
        buffer.push(data);
      });
      png.on("end", function() {
        cb(null, Buffer.concat(buffer));
      });
      png.pack();
    };
    exports.renderToFile = function renderToFile(path, qrData, options, cb) {
      if (typeof cb === "undefined") {
        cb = options;
        options = void 0;
      }
      let called = false;
      const done = (...args) => {
        if (called) return;
        called = true;
        cb.apply(null, args);
      };
      const stream = fs.createWriteStream(path);
      stream.on("error", done);
      stream.on("close", done);
      exports.renderToFileStream(stream, qrData, options);
    };
    exports.renderToFileStream = function renderToFileStream(stream, qrData, options) {
      const png = exports.render(qrData, options);
      png.pack().pipe(stream);
    };
  }
});

// ../node_modules/qrcode/lib/renderer/utf8.js
var require_utf8 = __commonJS({
  "../node_modules/qrcode/lib/renderer/utf8.js"(exports) {
    var Utils = require_utils2();
    var BLOCK_CHAR = {
      WW: " ",
      WB: "\u2584",
      BB: "\u2588",
      BW: "\u2580"
    };
    var INVERTED_BLOCK_CHAR = {
      BB: " ",
      BW: "\u2584",
      WW: "\u2588",
      WB: "\u2580"
    };
    function getBlockChar(top, bottom, blocks) {
      if (top && bottom) return blocks.BB;
      if (top && !bottom) return blocks.BW;
      if (!top && bottom) return blocks.WB;
      return blocks.WW;
    }
    exports.render = function(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      let blocks = BLOCK_CHAR;
      if (opts.color.dark.hex === "#ffffff" || opts.color.light.hex === "#000000") {
        blocks = INVERTED_BLOCK_CHAR;
      }
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      let output = "";
      let hMargin = Array(size + opts.margin * 2 + 1).join(blocks.WW);
      hMargin = Array(opts.margin / 2 + 1).join(hMargin + "\n");
      const vMargin = Array(opts.margin + 1).join(blocks.WW);
      output += hMargin;
      for (let i = 0; i < size; i += 2) {
        output += vMargin;
        for (let j = 0; j < size; j++) {
          const topModule = data[i * size + j];
          const bottomModule = data[(i + 1) * size + j];
          output += getBlockChar(topModule, bottomModule, blocks);
        }
        output += vMargin + "\n";
      }
      output += hMargin.slice(0, -1);
      if (typeof cb === "function") {
        cb(null, output);
      }
      return output;
    };
    exports.renderToFile = function renderToFile(path, qrData, options, cb) {
      if (typeof cb === "undefined") {
        cb = options;
        options = void 0;
      }
      const fs = __require("fs");
      const utf8 = exports.render(qrData, options);
      fs.writeFile(path, utf8, cb);
    };
  }
});

// ../node_modules/qrcode/lib/renderer/terminal/terminal.js
var require_terminal = __commonJS({
  "../node_modules/qrcode/lib/renderer/terminal/terminal.js"(exports) {
    exports.render = function(qrData, options, cb) {
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const black = "\x1B[40m  \x1B[0m";
      const white = "\x1B[47m  \x1B[0m";
      let output = "";
      const hMargin = Array(size + 3).join(white);
      const vMargin = Array(2).join(white);
      output += hMargin + "\n";
      for (let i = 0; i < size; ++i) {
        output += white;
        for (let j = 0; j < size; j++) {
          output += data[i * size + j] ? black : white;
        }
        output += vMargin + "\n";
      }
      output += hMargin + "\n";
      if (typeof cb === "function") {
        cb(null, output);
      }
      return output;
    };
  }
});

// ../node_modules/qrcode/lib/renderer/terminal/terminal-small.js
var require_terminal_small = __commonJS({
  "../node_modules/qrcode/lib/renderer/terminal/terminal-small.js"(exports) {
    var backgroundWhite = "\x1B[47m";
    var backgroundBlack = "\x1B[40m";
    var foregroundWhite = "\x1B[37m";
    var foregroundBlack = "\x1B[30m";
    var reset = "\x1B[0m";
    var lineSetupNormal = backgroundWhite + foregroundBlack;
    var lineSetupInverse = backgroundBlack + foregroundWhite;
    var createPalette = function(lineSetup, foregroundWhite2, foregroundBlack2) {
      return {
        // 1 ... white, 2 ... black, 0 ... transparent (default)
        "00": reset + " " + lineSetup,
        "01": reset + foregroundWhite2 + "\u2584" + lineSetup,
        "02": reset + foregroundBlack2 + "\u2584" + lineSetup,
        10: reset + foregroundWhite2 + "\u2580" + lineSetup,
        11: " ",
        12: "\u2584",
        20: reset + foregroundBlack2 + "\u2580" + lineSetup,
        21: "\u2580",
        22: "\u2588"
      };
    };
    var mkCodePixel = function(modules, size, x, y) {
      const sizePlus = size + 1;
      if (x >= sizePlus || y >= sizePlus || y < -1 || x < -1) return "0";
      if (x >= size || y >= size || y < 0 || x < 0) return "1";
      const idx = y * size + x;
      return modules[idx] ? "2" : "1";
    };
    var mkCode = function(modules, size, x, y) {
      return mkCodePixel(modules, size, x, y) + mkCodePixel(modules, size, x, y + 1);
    };
    exports.render = function(qrData, options, cb) {
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const inverse = !!(options && options.inverse);
      const lineSetup = options && options.inverse ? lineSetupInverse : lineSetupNormal;
      const white = inverse ? foregroundBlack : foregroundWhite;
      const black = inverse ? foregroundWhite : foregroundBlack;
      const palette = createPalette(lineSetup, white, black);
      const newLine = reset + "\n" + lineSetup;
      let output = lineSetup;
      for (let y = -1; y < size + 1; y += 2) {
        for (let x = -1; x < size; x++) {
          output += palette[mkCode(data, size, x, y)];
        }
        output += palette[mkCode(data, size, size, y)] + newLine;
      }
      output += reset;
      if (typeof cb === "function") {
        cb(null, output);
      }
      return output;
    };
  }
});

// ../node_modules/qrcode/lib/renderer/terminal.js
var require_terminal2 = __commonJS({
  "../node_modules/qrcode/lib/renderer/terminal.js"(exports) {
    var big = require_terminal();
    var small = require_terminal_small();
    exports.render = function(qrData, options, cb) {
      if (options && options.small) {
        return small.render(qrData, options, cb);
      }
      return big.render(qrData, options, cb);
    };
  }
});

// ../node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "../node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i = 0; i < data.length; i++) {
        const col = Math.floor(i % size);
        const row = Math.floor(i / size);
        if (!col && !newRow) newRow = true;
        if (data[i]) {
          lineLength++;
          if (!(i > 0 && col > 0 && data[i - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    exports.render = function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    };
  }
});

// ../node_modules/qrcode/lib/renderer/svg.js
var require_svg = __commonJS({
  "../node_modules/qrcode/lib/renderer/svg.js"(exports) {
    var svgTagRenderer = require_svg_tag();
    exports.render = svgTagRenderer.render;
    exports.renderToFile = function renderToFile(path, qrData, options, cb) {
      if (typeof cb === "undefined") {
        cb = options;
        options = void 0;
      }
      const fs = __require("fs");
      const svgTag = exports.render(qrData, options);
      const xmlStr = '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' + svgTag;
      fs.writeFile(path, xmlStr, cb);
    };
  }
});

// ../node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "../node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    exports.render = function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    };
    exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    };
  }
});

// ../node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "../node_modules/qrcode/lib/browser.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    exports.create = QRCode.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// ../node_modules/qrcode/lib/server.js
var require_server = __commonJS({
  "../node_modules/qrcode/lib/server.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode = require_qrcode();
    var PngRenderer = require_png2();
    var Utf8Renderer = require_utf8();
    var TerminalRenderer = require_terminal2();
    var SvgRenderer = require_svg();
    function checkParams(text, opts, cb) {
      if (typeof text === "undefined") {
        throw new Error("String required as first argument");
      }
      if (typeof cb === "undefined") {
        cb = opts;
        opts = {};
      }
      if (typeof cb !== "function") {
        if (!canPromise()) {
          throw new Error("Callback required as last argument");
        } else {
          opts = cb || {};
          cb = null;
        }
      }
      return {
        opts,
        cb
      };
    }
    function getTypeFromFilename(path) {
      return path.slice((path.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
    }
    function getRendererFromType(type) {
      switch (type) {
        case "svg":
          return SvgRenderer;
        case "txt":
        case "utf8":
          return Utf8Renderer;
        case "png":
        case "image/png":
        default:
          return PngRenderer;
      }
    }
    function getStringRendererFromType(type) {
      switch (type) {
        case "svg":
          return SvgRenderer;
        case "terminal":
          return TerminalRenderer;
        case "utf8":
        default:
          return Utf8Renderer;
      }
    }
    function render(renderFunc, text, params) {
      if (!params.cb) {
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode.create(text, params.opts);
            return renderFunc(data, params.opts, function(err, data2) {
              return err ? reject(err) : resolve(data2);
            });
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode.create(text, params.opts);
        return renderFunc(data, params.opts, params.cb);
      } catch (e) {
        params.cb(e);
      }
    }
    exports.create = QRCode.create;
    exports.toCanvas = require_browser().toCanvas;
    exports.toString = function toString(text, opts, cb) {
      const params = checkParams(text, opts, cb);
      const type = params.opts ? params.opts.type : void 0;
      const renderer = getStringRendererFromType(type);
      return render(renderer.render, text, params);
    };
    exports.toDataURL = function toDataURL(text, opts, cb) {
      const params = checkParams(text, opts, cb);
      const renderer = getRendererFromType(params.opts.type);
      return render(renderer.renderToDataURL, text, params);
    };
    exports.toBuffer = function toBuffer(text, opts, cb) {
      const params = checkParams(text, opts, cb);
      const renderer = getRendererFromType(params.opts.type);
      return render(renderer.renderToBuffer, text, params);
    };
    exports.toFile = function toFile(path, text, opts, cb) {
      if (typeof path !== "string" || !(typeof text === "string" || typeof text === "object")) {
        throw new Error("Invalid argument");
      }
      if (arguments.length < 3 && !canPromise()) {
        throw new Error("Too few arguments provided");
      }
      const params = checkParams(text, opts, cb);
      const type = params.opts.type || getTypeFromFilename(path);
      const renderer = getRendererFromType(type);
      const renderToFile = renderer.renderToFile.bind(null, path);
      return render(renderToFile, text, params);
    };
    exports.toFileStream = function toFileStream(stream, text, opts) {
      if (arguments.length < 2) {
        throw new Error("Too few arguments provided");
      }
      const params = checkParams(text, opts, stream.emit.bind(stream, "error"));
      const renderer = getRendererFromType("png");
      const renderToFileStream = renderer.renderToFileStream.bind(null, stream);
      render(renderToFileStream, text, params);
    };
  }
});

// ../node_modules/qrcode/lib/index.js
var require_lib = __commonJS({
  "../node_modules/qrcode/lib/index.js"(exports, module) {
    module.exports = require_server();
  }
});

// packages/bundle/src/host.ts
import { randomUUID as randomUUID5 } from "node:crypto";
import { appendFileSync, existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile as readFile3, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { basename, join as join4 } from "node:path";

// packages/core/src/constants.ts
var FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";
var APP_ID = "bot";
var APP_CLIENT_VERSION = "204009";
var CHANNEL_VERSION = "2.4.9";
var DEFAULT_BOT_AGENT = "dsh-wechat/0.0.0";
var DEFAULT_BOT_TYPE = "3";
var DEFAULT_LONG_POLL_TIMEOUT_MS = 35e3;
var DEFAULT_QR_POLL_TIMEOUT_MS = 35e3;
var DEFAULT_API_TIMEOUT_MS = 15e3;
var DEFAULT_LOGIN_TIMEOUT_MS = 5 * 6e4;
var MAX_QR_REFRESH = 3;
var RETRY_DELAY_MS = 2e3;
var BACKOFF_DELAY_MS = 3e4;
var MAX_CONSECUTIVE_FAILURES = 3;
var STALE_TOKEN_ERRCODE = -14;
var SESSION_PAUSE_MS = 60 * 60 * 1e3;
var CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

// packages/core/src/types.ts
var UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4
};
var MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2
};
var MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12
};
var MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2
};
var TypingStatus = {
  TYPING: 1,
  CANCEL: 2
};

// packages/core/src/http.ts
import { randomBytes, randomUUID } from "node:crypto";
var SendRefusedError = class extends Error {
  /** The code the service gave, kept for the log and for tests. */
  errcode;
  /**
   * @param message - What to tell the user.
   * @param errcode - The refusal code from the service.
   */
  constructor(message, errcode) {
    super(message);
    this.name = "SendRefusedError";
    this.errcode = errcode;
  }
};
function assertSendAccepted(response) {
  const errcode = response.errcode ?? response.ret;
  if (errcode === void 0 || errcode === 0) return;
  if (errcode === STALE_TOKEN_ERRCODE) {
    throw new SendRefusedError(
      "\u5FAE\u4FE1\u4F1A\u8BDD\u5DF2\u8D85\u65F6\uFF08session timeout\uFF09\u3002\u9700\u8981\u7528\u6237\u5148\u5728\u5FAE\u4FE1\u91CC\u7ED9\u673A\u5668\u4EBA\u53D1\u4E00\u6761\u6D88\u606F\uFF0C\u4E4B\u540E\u624D\u80FD\u4E3B\u52A8\u63A8\u9001\u3002",
      errcode
    );
  }
  throw new SendRefusedError(
    `\u53D1\u9001\u88AB\u5FAE\u4FE1\u62D2\u7EDD\uFF1Aerrcode=${String(errcode)} errmsg=${response.errmsg ?? "(\u65E0)"}`,
    errcode
  );
}
var LOSSLESS_ID_FIELDS = ["message_id", "msg_id", "svr_id"];
function parseWireJson(raw) {
  const alternation = LOSSLESS_ID_FIELDS.join("|");
  const rewritten = raw.replace(
    new RegExp(`"(${alternation})"\\s*:\\s*(\\d{6,})`, "g"),
    '"$1":"$2"'
  );
  return JSON.parse(rewritten);
}
function randomWechatUin() {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64");
}
var ApiHttpError = class extends Error {
  status;
  body;
  endpoint;
  constructor(endpoint, status, body) {
    super(`${endpoint} HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
};
function baseInfo(botAgent = DEFAULT_BOT_AGENT) {
  return { channel_version: CHANNEL_VERSION, bot_agent: botAgent };
}
async function apiCall(request) {
  const raw = await apiCallRaw(request);
  return parseWireJson(raw);
}
async function apiCallRaw(request) {
  const base = request.baseUrl.endsWith("/") ? request.baseUrl : `${request.baseUrl}/`;
  const url = new URL(request.endpoint, base);
  const headers = buildHeaders({ token: request.token });
  const controller = request.timeoutMs === void 0 ? void 0 : new AbortController();
  const timer = controller === void 0 ? void 0 : setTimeout(() => controller.abort(), request.timeoutMs);
  const signal = combineSignals(controller?.signal, request.signal);
  try {
    const response = await fetch(url.toString(), {
      method: request.method ?? "POST",
      headers,
      ...request.body === void 0 ? {} : { body: JSON.stringify(request.body) },
      ...signal === void 0 ? {} : { signal }
    });
    const text = await response.text();
    if (!response.ok) throw new ApiHttpError(request.endpoint, response.status, text);
    return text;
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
}
function buildHeaders(params) {
  const headers = {
    "Content-Type": "application/json",
    "iLink-App-Id": APP_ID,
    "iLink-App-ClientVersion": APP_CLIENT_VERSION,
    "X-WECHAT-UIN": randomWechatUin()
  };
  const token = params.token?.trim();
  if (token) {
    headers.AuthorizationType = "ilink_bot_token";
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
function newClientId(prefix = "dsh-wechat") {
  return `${prefix}-${randomUUID()}`;
}
function combineSignals(a, b) {
  if (a === void 0) return b;
  if (b === void 0) return a;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

// packages/core/src/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes as randomBytes2 } from "node:crypto";
function encryptAesEcb(plaintext, key) {
  assertKeyLength(key);
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
function decryptAesEcb(ciphertext, key) {
  assertKeyLength(key);
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function aesEcbPaddedSize(plaintextSize) {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}
function parseAesKey(value, label = "media") {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label}: \u7F3A\u5C11 AES key`);
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(
    `${label}: AES key \u9700\u4E3A 16 \u5B57\u8282\u6216 32 \u4F4D hex \u5B57\u7B26\u4E32\uFF0C\u5B9E\u9645\u89E3\u51FA ${decoded.length} \u5B57\u8282`
  );
}
function aesKeyToHex(key) {
  return key.toString("hex");
}
function aesKeyToBase64(key) {
  return Buffer.from(key.toString("hex"), "utf8").toString("base64");
}
function assertKeyLength(key) {
  if (key.length !== 16) {
    throw new Error(`AES-128 \u9700\u8981 16 \u5B57\u8282\u5BC6\u94A5\uFF0C\u5B9E\u9645 ${key.length} \u5B57\u8282`);
  }
}

// packages/core/src/state.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
var DEFAULT_SETTINGS = {
  mergeWindowMs: 1e4,
  maxReplyChars: 4e3,
  settleMs: 1200,
  quoteHistory: 40,
  autoReplyAttachments: true,
  requireConfirmation: true,
  permissionPreset: "danger-full-access",
  allowCrossSessionNotify: true,
  presenceNote: '[\u6E20\u9053\uFF1A\u5FAE\u4FE1] \u4F60\u5728\u548C\u5FAE\u4FE1\u4E0A\u7684\u7528\u6237\u5BF9\u8BDD\uFF0C\u5BF9\u65B9\u5728\u624B\u673A\u4E0A\uFF0C\u770B\u4E0D\u5230\u8FD9\u53F0\u7535\u8111\u7684\u5C4F\u5E55\u548C\u6587\u4EF6\u7CFB\u7EDF\u3002\u4E0D\u8981\u8BA9\u4ED6\u53BB"\u6253\u5F00\u67D0\u4E2A\u8DEF\u5F84"\u6216"\u770B\u67D0\u4E2A\u6587\u4EF6"\u3002\u9700\u8981\u7ED9\u4ED6\u770B\u4E1C\u897F\u65F6\uFF0C\u76F4\u63A5\u53D1\u9001\uFF1A\u56FE\u7247\u6216\u89C6\u9891\u4F1A\u663E\u793A\u6210\u7167\u7247/\u89C6\u9891\uFF0C\u5176\u4ED6\u6587\u4EF6\u4F1A\u4F5C\u4E3A\u9644\u4EF6\u53D1\u8FC7\u53BB\u3002\u56DE\u590D\u5C3D\u91CF\u7B80\u77ED\uFF0C\u9002\u5408\u624B\u673A\u9605\u8BFB\u3002'
};
function resolveSettings(state) {
  const stored = state.settings ?? {};
  return {
    mergeWindowMs: stored.mergeWindowMs ?? DEFAULT_SETTINGS.mergeWindowMs,
    maxReplyChars: stored.maxReplyChars ?? DEFAULT_SETTINGS.maxReplyChars,
    settleMs: stored.settleMs ?? DEFAULT_SETTINGS.settleMs,
    quoteHistory: stored.quoteHistory ?? DEFAULT_SETTINGS.quoteHistory,
    autoReplyAttachments: stored.autoReplyAttachments ?? DEFAULT_SETTINGS.autoReplyAttachments,
    requireConfirmation: stored.requireConfirmation ?? DEFAULT_SETTINGS.requireConfirmation,
    permissionPreset: stored.permissionPreset ?? DEFAULT_SETTINGS.permissionPreset,
    allowCrossSessionNotify: stored.allowCrossSessionNotify ?? DEFAULT_SETTINGS.allowCrossSessionNotify,
    presenceNote: stored.presenceNote ?? DEFAULT_SETTINGS.presenceNote
  };
}
var SENT_MESSAGE_HISTORY = 40;
var PENDING_NOTIFICATION_LIMIT = 20;
var PENDING_NOTIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
function queuePendingNotification(state, entry, now = Date.now(), limit = PENDING_NOTIFICATION_LIMIT) {
  const queue = state.pendingNotifications ??= [];
  queue.push({ ...entry, id: entry.id ?? randomUUID2(), queuedAt: entry.queuedAt ?? now });
  let dropped = 0;
  while (limit >= 0 && queue.length > limit) {
    queue.shift();
    dropped += 1;
  }
  return dropped;
}
function expirePendingNotifications(state, now = Date.now(), maxAgeMs = PENDING_NOTIFICATION_MAX_AGE_MS) {
  const queue = state.pendingNotifications;
  if (queue === void 0 || queue.length === 0) return [];
  const expired = queue.filter((entry) => now - entry.queuedAt > maxAgeMs);
  if (expired.length > 0) {
    state.pendingNotifications = queue.filter((entry) => now - entry.queuedAt <= maxAgeMs);
  }
  return expired;
}
var EMPTY_STATE = {
  version: 1,
  accounts: {},
  syncBufs: {},
  contextTokens: {},
  bindings: {},
  sentMessages: {}
};
function rememberSentMessage(state, accountId, conversationId, message, limit = SENT_MESSAGE_HISTORY) {
  const perAccount = state.sentMessages[accountId] ??= {};
  const history = perAccount[conversationId] ??= [];
  history.push(message);
  if (limit >= 0 && history.length > limit) {
    history.splice(0, history.length - limit);
  }
}
function findSentMessage(state, accountId, messageId) {
  for (const history of Object.values(state.sentMessages[accountId] ?? {})) {
    for (const entry of history) if (entry.messageId === messageId) return entry;
  }
  return void 0;
}
var StateStore = class _StateStore {
  file;
  #cache;
  /** In-flight disk load, shared by concurrent {@link read} calls. */
  #loading;
  /** Serializes concurrent writes; the channel is event-driven and re-entrant. */
  #writeChain = Promise.resolve();
  /**
   * @param file - Absolute path of the state file. Parent directories are created on demand.
   */
  constructor(file) {
    this.file = file;
  }
  /** Resolve the default state path under a DSH home directory. */
  static under(dshHome) {
    return new _StateStore(join(dshHome, "wechat", "state.json"));
  }
  /** Read the current state, tolerating a missing or corrupt file. */
  async read() {
    this.#loading ??= this.#load();
    return await this.#loading;
  }
  /** Load from disk once, caching the result. Only called through {@link read}. */
  async #load() {
    if (this.#cache !== void 0) return this.#cache;
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf-8"));
      this.#cache = normalize(parsed);
    } catch {
      this.#cache = structuredClone(EMPTY_STATE);
    }
    return this.#cache;
  }
  /**
   * Apply a mutation and persist the result.
   *
   * @param mutate - Receives the live state object and may change it in place.
   */
  async update(mutate) {
    const state = await this.read();
    mutate(state);
    this.#writeChain = this.#writeChain.then(() => this.#persist(state));
    await this.#writeChain;
  }
  /** Drop every artifact for one account. Used when a token goes stale. */
  async forgetAccount(accountId) {
    await this.update((state) => {
      delete state.accounts[accountId];
      delete state.syncBufs[accountId];
      delete state.contextTokens[accountId];
      for (const [key, binding] of Object.entries(state.bindings)) {
        if (binding.accountId === accountId) delete state.bindings[key];
      }
    });
  }
  async #persist(state) {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf-8", mode: 384 });
    try {
      await rename(temp, this.file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
};
function normalize(parsed) {
  return {
    version: 1,
    accounts: isRecord(parsed.accounts) ? parsed.accounts : {},
    syncBufs: isRecord(parsed.syncBufs) ? parsed.syncBufs : {},
    contextTokens: isRecord(parsed.contextTokens) ? parsed.contextTokens : {},
    bindings: isRecord(parsed.bindings) ? parsed.bindings : {},
    sentMessages: isRecord(parsed.sentMessages) ? parsed.sentMessages : {},
    /*
     * Filtered rather than trusted. This array is read back and sent to the user, so an entry with a
     * missing conversation or a non-string text would reach the send path as `undefined`.
     */
    ...Array.isArray(parsed.pendingNotifications) ? { pendingNotifications: parsed.pendingNotifications.filter(isPendingNotification) } : {},
    ...isRecord(parsed.settings) ? { settings: normalizeSettings(parsed.settings) } : {},
    ...typeof parsed.autoStart === "boolean" ? { autoStart: parsed.autoStart } : {}
  };
}
function isPendingNotification(raw) {
  if (!isRecord(raw)) return false;
  return typeof raw.id === "string" && typeof raw.conversationId === "string" && typeof raw.text === "string" && typeof raw.queuedAt === "number" && (raw.path === void 0 || typeof raw.path === "string");
}
function normalizeSettings(raw) {
  const settings = {};
  for (const key of ["mergeWindowMs", "maxReplyChars", "settleMs", "quoteHistory"]) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) settings[key] = value;
  }
  if (typeof raw.autoReplyAttachments === "boolean") {
    settings.autoReplyAttachments = raw.autoReplyAttachments;
  }
  if (typeof raw.requireConfirmation === "boolean") {
    settings.requireConfirmation = raw.requireConfirmation;
  }
  if (typeof raw.presenceNote === "string") settings.presenceNote = raw.presenceNote;
  return settings;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// packages/core/src/login.ts
async function fetchQRCode(params) {
  const botType = params.botType ?? DEFAULT_BOT_TYPE;
  return await apiCall({
    baseUrl: params.baseUrl ?? FIXED_BASE_URL,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    method: "POST",
    body: { local_token_list: [...params.localTokenList ?? []] },
    timeoutMs: 2e4
  });
}
async function pollQRStatus(params) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`;
  if (params.verifyCode) endpoint += `&verify_code=${encodeURIComponent(params.verifyCode)}`;
  try {
    return await apiCall({
      baseUrl: params.baseUrl ?? FIXED_BASE_URL,
      endpoint,
      method: "GET",
      timeoutMs: params.timeoutMs ?? DEFAULT_QR_POLL_TIMEOUT_MS,
      signal: params.signal
    });
  } catch (error) {
    if (isAbort(error)) return { status: "wait" };
    throw error;
  }
}
async function* login(options = {}, signal) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let baseUrl = options.baseUrl ?? FIXED_BASE_URL;
  const localTokenList = [...options.existingTokens ?? []];
  const reuseExisting = options.reuseExisting ?? "adopt";
  let qr = await fetchQRCode({ localTokenList, botType: options.botType, baseUrl });
  yield { kind: "qr", qrUrl: qr.qrcode_img_content, qrcode: qr.qrcode, refreshed: false };
  let verifyCode;
  let scannedNotified = false;
  let refreshCount = 0;
  let verifyAttempt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { alreadyBound: false, reason: "cancelled" };
    let status;
    try {
      status = await pollQRStatus({ qrcode: qr.qrcode, verifyCode, baseUrl, signal });
    } catch (error) {
      if (isAbort(error) && signal?.aborted) return { alreadyBound: false, reason: "cancelled" };
      await sleep(1500, signal);
      continue;
    }
    options.onStatus?.(status);
    switch (status.status) {
      case "wait":
        break;
      case "scaned":
        if (!scannedNotified) {
          scannedNotified = true;
          yield { kind: "scanned" };
        }
        verifyCode = void 0;
        break;
      case "need_verifycode": {
        verifyAttempt += 1;
        if (verifyAttempt > 3) {
          const reason2 = "\u9A8C\u8BC1\u7801\u591A\u6B21\u672A\u901A\u8FC7";
          yield { kind: "failed", reason: reason2 };
          return { alreadyBound: false, reason: reason2 };
        }
        verifyCode = yield { kind: "verifycode-required", attempt: verifyAttempt };
        break;
      }
      case "verify_code_blocked": {
        const reason2 = "\u9A8C\u8BC1\u7801\u88AB\u670D\u52A1\u7AEF\u9501\u5B9A\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
        yield { kind: "failed", reason: reason2 };
        return { alreadyBound: false, reason: reason2 };
      }
      case "expired": {
        refreshCount += 1;
        const willRetry = refreshCount <= MAX_QR_REFRESH;
        yield { kind: "expired", refreshCount, willRetry };
        if (!willRetry) {
          const reason2 = "\u4E8C\u7EF4\u7801\u53CD\u590D\u8FC7\u671F";
          yield { kind: "failed", reason: reason2 };
          return { alreadyBound: false, reason: reason2 };
        }
        qr = await fetchQRCode({ localTokenList, botType: options.botType, baseUrl });
        yield { kind: "qr", qrUrl: qr.qrcode_img_content, qrcode: qr.qrcode, refreshed: true };
        scannedNotified = false;
        verifyCode = void 0;
        break;
      }
      case "scaned_but_redirect": {
        if (status.redirect_host) {
          yield { kind: "redirected", host: status.redirect_host };
          baseUrl = `https://${status.redirect_host}`;
        }
        break;
      }
      case "binded_redirect": {
        yield { kind: "already-bound" };
        if (reuseExisting === "adopt") return { alreadyBound: true };
        return { alreadyBound: true, reason: "\u670D\u52A1\u7AEF\u56DE\u590D\u8BE5\u8D26\u53F7\u5DF2\u88AB\u7ED1\u5B9A" };
      }
      case "confirmed": {
        const account = accountFromStatus(status, baseUrl);
        if (account === void 0) {
          const reason2 = status.ilink_bot_id ? "\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE bot_token" : "\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE ilink_bot_id";
          yield { kind: "failed", reason: reason2 };
          return { alreadyBound: false, reason: reason2 };
        }
        yield { kind: "confirmed", account };
        return { account, alreadyBound: false };
      }
      default: {
        const unknown = status;
        const reason2 = `\u672A\u9884\u671F\u7684\u72B6\u6001: ${String(unknown.status)}`;
        yield { kind: "failed", reason: reason2 };
        return { alreadyBound: false, reason: reason2 };
      }
    }
    await sleep(1e3, signal);
  }
  const reason = "\u767B\u5F55\u8D85\u65F6";
  yield { kind: "failed", reason };
  return { alreadyBound: false, reason };
}
function accountFromStatus(status, fallbackBaseUrl) {
  if (!status.ilink_bot_id) return void 0;
  const token = status.bot_token?.trim();
  if (!token) return void 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    accountId: status.ilink_bot_id,
    token,
    baseUrl: status.baseurl?.trim() || fallbackBaseUrl,
    ...status.ilink_user_id === void 0 ? {} : { userId: status.ilink_user_id },
    savedAt: now,
    boundAt: now
  };
}
function isAbort(error) {
  return error instanceof Error && error.name === "AbortError";
}
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

// packages/core/src/media.ts
import { createHash, randomBytes as randomBytes3, randomUUID as randomUUID3 } from "node:crypto";

// packages/core/src/silk.ts
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var SILK_SAMPLE_RATE = 24e3;
var cached;
function resolveSilk() {
  const start = fileURLToPath(import.meta.url);
  const roots = [];
  let dir = dirname2(start);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join2(dir, "package.json"))) roots.push(dir);
    const parent = dirname2(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const home = process.env.DSH_HOME ?? join2(homedir(), ".dsh");
  roots.push(join2(home, "profiles", "desktop", "node_modules"));
  roots.push(join2(home, "node_modules"));
  for (const root of roots) {
    try {
      const require2 = createRequire(join2(root, "package.json"));
      return require2("silk-wasm");
    } catch {
    }
  }
  throw new Error("silk-wasm \u672A\u627E\u5230");
}
function pcmToWav(pcm, sampleRate = SILK_SAMPLE_RATE) {
  const totalSize = 44 + pcm.byteLength;
  const buffer = Buffer.allocUnsafe(totalSize);
  let offset = 0;
  buffer.write("RIFF", offset);
  offset += 4;
  buffer.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buffer.write("WAVE", offset);
  offset += 4;
  buffer.write("fmt ", offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(sampleRate * 2, offset);
  offset += 4;
  buffer.writeUInt16LE(2, offset);
  offset += 2;
  buffer.writeUInt16LE(16, offset);
  offset += 2;
  buffer.write("data", offset);
  offset += 4;
  buffer.writeUInt32LE(pcm.byteLength, offset);
  offset += 4;
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, offset);
  return buffer;
}
async function silkToWav(silk) {
  if (cached === void 0) {
    try {
      cached = resolveSilk();
    } catch {
      cached = null;
    }
  }
  if (cached === null) return void 0;
  try {
    const decoded = await cached.decode(
      new Uint8Array(silk.buffer, silk.byteOffset, silk.byteLength),
      SILK_SAMPLE_RATE
    );
    return { data: pcmToWav(decoded.data), durationMs: decoded.duration };
  } catch {
    return void 0;
  }
}

// packages/core/src/media.ts
var UPLOAD_MAX_RETRIES = 3;
var MAX_MEDIA_BYTES = 100 * 1024 * 1024;
async function uploadMedia(options) {
  const { account, toUserId, data, fileName, mediaType } = options;
  if (data.length === 0) throw new Error("\u4E0D\u80FD\u53D1\u9001\u7A7A\u6587\u4EF6");
  if (data.length > MAX_MEDIA_BYTES) {
    throw new Error(`\u6587\u4EF6\u8D85\u8FC7 ${Math.floor(MAX_MEDIA_BYTES / 1024 / 1024)} MB \u4E0A\u9650`);
  }
  const rawSize = data.length;
  const rawMd5 = createHash("md5").update(data).digest("hex");
  const ciphertextSize = aesEcbPaddedSize(rawSize);
  const fileKey = randomBytes3(16).toString("hex");
  const aesKey = randomBytes3(16);
  const slot = await apiCall({
    baseUrl: account.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: {
      filekey: fileKey,
      media_type: mediaType,
      to_user_id: toUserId,
      rawsize: rawSize,
      rawfilemd5: rawMd5,
      filesize: ciphertextSize,
      // Videos and images can carry thumbnails, but the upload still works without
      // one and generating them locally is not worth the complexity here.
      no_need_thumb: true,
      // The service expects the hex form here; the message item carries the same key
      // again, also as hex, in `image_item.aeskey`.
      aeskey: aesKeyToHex(aesKey),
      base_info: { channel_version: "2.4.9" }
    },
    token: account.token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  const target = resolveUploadTarget({
    slot,
    cdnBaseUrl: options.cdnBaseUrl ?? CDN_BASE_URL,
    fileKey
  });
  const headerParam = await pushToCdn({ target, data, aesKey, label: fileName });
  const downloadParam = resolveDownloadParam(headerParam);
  options.onDiagnostic?.({
    uploadUrl: target,
    downloadParam,
    response: slot
  });
  return {
    media: {
      encrypt_query_param: downloadParam,
      aes_key: aesKeyToBase64(aesKey),
      // 1 = "thumbnail / mid-size metadata packed in". This is what the reference
      // implementation sends for images and files, and it is the value the recipient
      // expects; 0 makes the reference unreadable to the client.
      encrypt_type: 1
    },
    size: rawSize,
    ciphertextSize,
    fileName,
    md5: rawMd5,
    aesKeyHex: aesKeyToHex(aesKey)
  };
}
async function sendImage(params) {
  const item = {
    type: MessageItemType.IMAGE,
    image_item: {
      media: params.uploaded.media,
      mid_size: params.uploaded.ciphertextSize
    }
  };
  return await sendItem({
    account: params.account,
    to: params.to,
    item,
    ...params.contextToken === void 0 ? {} : { contextToken: params.contextToken },
    ...params.signal === void 0 ? {} : { signal: params.signal }
  });
}
async function sendVideo(params) {
  const item = {
    type: MessageItemType.VIDEO,
    video_item: {
      media: params.uploaded.media,
      video_size: params.uploaded.ciphertextSize
    }
  };
  return await sendItem({
    account: params.account,
    to: params.to,
    item,
    ...params.contextToken === void 0 ? {} : { contextToken: params.contextToken },
    ...params.signal === void 0 ? {} : { signal: params.signal }
  });
}
async function sendFile(params) {
  const item = {
    type: MessageItemType.FILE,
    file_item: {
      media: params.uploaded.media,
      file_name: params.uploaded.fileName,
      len: String(params.uploaded.size)
    }
  };
  return await sendItem({
    account: params.account,
    to: params.to,
    item,
    ...params.contextToken === void 0 ? {} : { contextToken: params.contextToken },
    ...params.signal === void 0 ? {} : { signal: params.signal }
  });
}
async function sendItem(params) {
  const clientId = `dsh-wechat-${randomUUID3()}`;
  const response = await apiCall({
    baseUrl: params.account.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: {
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [params.item],
        ...params.contextToken === void 0 ? {} : { context_token: params.contextToken },
        ...params.runId === void 0 ? {} : { run_id: params.runId }
      }
    },
    token: params.account.token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    ...params.signal === void 0 ? {} : { signal: params.signal }
  });
  assertSendAccepted(response);
  return {
    clientId,
    ...response.message_id === void 0 ? {} : { serverMessageId: response.message_id }
  };
}
async function sendToolCard(params) {
  const now = Date.now();
  const item = {
    type: params.phase === "start" ? MessageItemType.TOOL_CALL_START : MessageItemType.TOOL_CALL_RESULT,
    create_time_ms: now,
    is_completed: params.phase === "end",
    ...params.phase === "start" ? {
      tool_call_start_item: {
        tool_name: params.toolName,
        ...params.toolCallId === void 0 ? {} : { tool_call_id: params.toolCallId }
      }
    } : {
      tool_call_result_item: {
        tool_name: params.toolName,
        ...params.toolCallId === void 0 ? {} : { tool_call_id: params.toolCallId },
        // The reference client normalises to exactly these four values.
        status: params.failed === true ? "failed" : "completed"
      }
    }
  };
  return await sendItem({
    account: params.account,
    to: params.to,
    item,
    ...params.contextToken === void 0 ? {} : { contextToken: params.contextToken },
    ...params.runId === void 0 ? {} : { runId: params.runId },
    ...params.signal === void 0 ? {} : { signal: params.signal }
  });
}
async function downloadItemMedia(options) {
  const { item } = options;
  const cdnBaseUrl = options.cdnBaseUrl ?? CDN_BASE_URL;
  if (item.type === MessageItemType.IMAGE && item.image_item) {
    const image = item.image_item;
    const reference = image.media;
    if (!hasReference(reference) || !image.aeskey && !reference?.aes_key) return void 0;
    const data = await fetchAndDecrypt({
      reference,
      // Images put the raw hex key on the item; it takes precedence.
      key: resolveItemKey({ hex: image.aeskey, base64: reference.aes_key, label: "\u56FE\u7247" }),
      cdnBaseUrl,
      label: "\u56FE\u7247",
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    return { kind: "image", data, fileName: `image-${timestamp()}.jpg`, contentType: "image/jpeg" };
  }
  if (item.type === MessageItemType.FILE && item.file_item) {
    const file = item.file_item;
    const reference = file.media;
    if (!hasReference(reference) || !reference?.aes_key) return void 0;
    const data = await fetchAndDecrypt({
      reference,
      key: resolveItemKey({ base64: reference.aes_key, label: "\u6587\u4EF6" }),
      cdnBaseUrl,
      label: "\u6587\u4EF6",
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    return {
      kind: "file",
      data,
      fileName: file.file_name ?? `file-${timestamp()}.bin`,
      ...file.len === void 0 ? {} : { declaredSize: Number(file.len) }
    };
  }
  if (item.type === MessageItemType.VOICE && item.voice_item) {
    const voice = item.voice_item;
    const reference = voice.media;
    if (!hasReference(reference) || !reference?.aes_key) return void 0;
    const silk = await fetchAndDecrypt({
      reference,
      key: resolveItemKey({ base64: reference.aes_key, label: "\u8BED\u97F3" }),
      cdnBaseUrl,
      label: "\u8BED\u97F3",
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    const wav = await silkToWav(silk);
    const data = wav?.data ?? silk;
    return {
      kind: "voice",
      data,
      fileName: wav === void 0 ? `voice-${timestamp()}.silk` : `voice-${timestamp()}.wav`,
      contentType: wav === void 0 ? "audio/silk" : "audio/wav",
      ...voice.text === void 0 ? {} : { transcript: voice.text },
      ...voice.encode_type === void 0 ? {} : { codec: voice.encode_type },
      ...wav === void 0 ? {} : { durationMs: wav.durationMs }
    };
  }
  if (item.type === MessageItemType.VIDEO && item.video_item) {
    const video = item.video_item;
    const reference = video.media;
    if (!hasReference(reference) || !reference?.aes_key) return void 0;
    const data = await fetchAndDecrypt({
      reference,
      key: resolveItemKey({ base64: reference.aes_key, label: "\u89C6\u9891" }),
      cdnBaseUrl,
      label: "\u89C6\u9891",
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    return {
      kind: "video",
      data,
      fileName: `video-${timestamp()}.mp4`,
      contentType: "video/mp4",
      // The sender declares the length; carrying it lets the agent reason about the clip
      // without opening it.
      ...video.play_length === void 0 ? {} : { durationMs: video.play_length },
      ...video.video_md5 === void 0 ? {} : { md5: video.video_md5 }
    };
  }
  return void 0;
}
function isMediaItem(item) {
  switch (item.type) {
    case MessageItemType.IMAGE:
      return item.image_item?.media !== void 0;
    case MessageItemType.FILE:
      return item.file_item?.media !== void 0;
    case MessageItemType.VOICE:
      return item.voice_item?.media !== void 0;
    case MessageItemType.VIDEO:
      return item.video_item?.media !== void 0;
    default:
      return false;
  }
}
function buildDownloadUrl(reference, cdnBaseUrl = CDN_BASE_URL) {
  const full = reference.full_url?.trim();
  if (full) return full;
  const param = reference.encrypt_query_param?.trim();
  if (!param) throw new Error("\u5A92\u4F53\u5F15\u7528\u91CC\u65E2\u6CA1\u6709 full_url \u4E5F\u6CA1\u6709 encrypt_query_param");
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(param)}`;
}
var DOWNLOAD_MAX_RETRIES = 4;
var DOWNLOAD_RETRY_DELAY_MS = 600;
async function fetchAndDecrypt(params) {
  const url = buildDownloadUrl(params.reference, params.cdnBaseUrl);
  const ciphertext = await fetchCdnBytes({
    url,
    label: params.label,
    ...params.signal === void 0 ? {} : { signal: params.signal }
  });
  try {
    return decryptAesEcb(ciphertext, params.key);
  } catch (error) {
    throw new Error(
      `${params.label}: \u89E3\u5BC6\u5931\u8D25\uFF08${ciphertext.length} \u5B57\u8282\u5BC6\u6587\uFF09\u2014\u2014 key \u4E0E\u5185\u5BB9\u4E0D\u5339\u914D\u3002${error instanceof Error ? error.message : String(error)}`
    );
  }
}
async function fetchCdnBytes(params) {
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt += 1) {
    const response = await fetch(params.url, {
      ...params.signal === void 0 ? {} : { signal: params.signal }
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    const body = await response.text().catch(() => "");
    const detail = `HTTP ${response.status}${body ? ` \u2014 ${body.slice(0, 300)}` : ""}`;
    const retryable = response.status === 404 || response.status >= 500;
    if (!retryable || attempt === DOWNLOAD_MAX_RETRIES) {
      throw new Error(`${params.label} \u4E0B\u8F7D\u5931\u8D25 ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_RETRY_DELAY_MS * attempt));
  }
  throw new Error(`${params.label} \u4E0B\u8F7D\u5931\u8D25\uFF08\u5DF2\u91CD\u8BD5 ${DOWNLOAD_MAX_RETRIES} \u6B21\uFF09`);
}
function hasReference(reference) {
  if (reference === void 0) return false;
  return Boolean(reference.full_url?.trim() || reference.encrypt_query_param?.trim());
}
function resolveItemKey(params) {
  if (params.hex) return Buffer.from(params.hex, "hex");
  if (params.base64) return parseAesKey(params.base64, params.label);
  throw new Error(`${params.label}: \u6D88\u606F\u91CC\u6CA1\u6709\u53EF\u7528\u7684 AES key`);
}
function resolveUploadTarget(params) {
  const full = params.slot.upload_full_url?.trim();
  if (full) return full;
  const param = params.slot.upload_param?.trim();
  if (!param) {
    throw new Error("\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE\u4E0A\u4F20\u5730\u5740\uFF08upload_full_url \u4E0E upload_param \u90FD\u4E3A\u7A7A\uFF09");
  }
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(param)}&filekey=${encodeURIComponent(params.fileKey)}`;
}
function resolveDownloadParam(headerParam) {
  return headerParam;
}
async function pushToCdn(params) {
  const ciphertext = encryptAesEcb(params.data, params.aesKey);
  let lastError;
  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(params.target, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
        ...params.signal === void 0 ? {} : { signal: params.signal }
      });
      if (response.status >= 400 && response.status < 500) {
        const detail = response.headers.get("x-error-message") ?? await response.text();
        throw new Error(`CDN \u62D2\u7EDD\u4E86\u4E0A\u4F20 (HTTP ${response.status}): ${detail.slice(0, 200)}`);
      }
      if (!response.ok) {
        throw new Error(`CDN \u4E0A\u4F20\u5931\u8D25 HTTP ${response.status}`);
      }
      const downloadParam = response.headers.get("x-encrypted-param");
      if (!downloadParam) throw new Error("CDN \u4E0A\u4F20\u6210\u529F\u4F46\u672A\u8FD4\u56DE x-encrypted-param");
      return downloadParam;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.startsWith("CDN \u62D2\u7EDD")) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("CDN \u4E0A\u4F20\u591A\u6B21\u5931\u8D25");
}
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}

// packages/core/src/channel.ts
var ChannelMonitor = class {
  #options;
  #sleep;
  #syncBuf;
  #longPollTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
  #consecutiveFailures = 0;
  /** Set when the account is inside the stale-token cooldown. */
  #pausedUntil = 0;
  #typingTicket;
  constructor(options) {
    this.#options = options;
    this.#syncBuf = options.initialSyncBuf ?? "";
    this.#sleep = options.sleep ?? defaultSleep;
  }
  /** Current cursor, for persistence by the caller. */
  get syncBuf() {
    return this.#syncBuf;
  }
  /**
   * Restore a persisted cursor before the first poll.
   *
   * Must be called before {@link run}: the server treats the cursor as incremental,
   * so starting from empty would replay or drop whatever the account received while
   * the process was down.
   */
  restoreSyncBuf(buf) {
    if (this.#syncBuf === "") this.#syncBuf = buf;
  }
  /** True while the stale-token cooldown is active. */
  get paused() {
    return Date.now() < this.#pausedUntil;
  }
  /** Milliseconds left in the cooldown, or zero. */
  get remainingPauseMs() {
    return Math.max(0, this.#pausedUntil - Date.now());
  }
  /**
   * Run until aborted, the token goes stale, or a fatal error occurs.
   *
   * @param signal - Abort to stop promptly, including an in-flight long poll.
   */
  async run(signal) {
    const { account } = this.#options;
    while (!signal.aborted) {
      if (this.paused) {
        await this.#sleep(this.remainingPauseMs, signal);
        if (signal.aborted) break;
        continue;
      }
      let response;
      try {
        response = await this.#getUpdates(account, signal);
      } catch (error) {
        if (signal.aborted) break;
        this.#options.onError?.(error);
        this.#consecutiveFailures += 1;
        await this.#sleep(this.#failureDelay(), signal);
        continue;
      }
      if (typeof response.longpolling_timeout_ms === "number" && response.longpolling_timeout_ms > 0) {
        this.#longPollTimeoutMs = response.longpolling_timeout_ms;
      }
      const errcode = response.errcode ?? response.ret;
      if (errcode !== void 0 && errcode !== 0) {
        if (errcode === STALE_TOKEN_ERRCODE) {
          this.#pausedUntil = Date.now() + SESSION_PAUSE_MS;
          this.#options.onStop?.("stale-token", "bot token \u5DF2\u5931\u6548\uFF0C\u9700\u8981\u91CD\u65B0\u626B\u7801\u7ED1\u5B9A");
          return "stale-token";
        }
        this.#consecutiveFailures += 1;
        this.#options.onError?.(
          new Error(`getupdates \u5931\u8D25 ret=${response.ret} errcode=${response.errcode} errmsg=${response.errmsg ?? ""}`)
        );
        await this.#sleep(this.#failureDelay(), signal);
        continue;
      }
      this.#consecutiveFailures = 0;
      if (response.get_updates_buf) {
        this.#syncBuf = response.get_updates_buf;
        await this.#options.onSyncBuf?.(this.#syncBuf);
      }
      for (const raw of response.msgs ?? []) {
        const inbound = toInbound(account, raw);
        if (inbound === void 0) continue;
        try {
          await this.#options.onMessage(inbound);
        } catch (error) {
          this.#options.onError?.(error);
        }
      }
    }
    this.#options.onStop?.("aborted");
    return "aborted";
  }
  /** Show or clear the "typing…" indicator for a peer. Best effort. */
  async setTyping(peerId, typing) {
    const { account } = this.#options;
    try {
      if (this.#typingTicket === void 0) {
        const config = await apiCall({
          baseUrl: account.baseUrl,
          endpoint: "ilink/bot/getconfig",
          body: { ilink_user_id: peerId },
          token: account.token,
          timeoutMs: 1e4
        });
        const errcode = config.errcode ?? config.ret;
        if (errcode !== void 0 && errcode !== 0) {
          this.#options.onError?.(
            new Error(
              `getconfig \u5931\u8D25 ret=${String(config.ret ?? "")} errcode=${String(config.errcode ?? "")} errmsg=${config.errmsg ?? ""}`
            )
          );
        }
        this.#typingTicket = config.typing_ticket;
      }
      if (!this.#typingTicket) return;
      await apiCall({
        baseUrl: account.baseUrl,
        endpoint: "ilink/bot/sendtyping",
        body: {
          ilink_user_id: peerId,
          typing_ticket: this.#typingTicket,
          status: typing ? TypingStatus.TYPING : TypingStatus.CANCEL
        },
        token: account.token,
        timeoutMs: 1e4
      });
    } catch (error) {
      this.#options.onError?.(error);
    }
  }
  /** Notify the server that this client is stopping. Best effort. */
  async notifyStop() {
    const { account } = this.#options;
    try {
      await apiCall({
        baseUrl: account.baseUrl,
        endpoint: "ilink/bot/msg/notifystop",
        body: { base_info: baseInfo(this.#options.botAgent ?? DEFAULT_BOT_AGENT) },
        token: account.token,
        timeoutMs: 5e3
      });
    } catch {
    }
  }
  async #getUpdates(account, signal) {
    const clientTimeout = this.#longPollTimeoutMs + 5e3;
    try {
      return await apiCall({
        baseUrl: account.baseUrl,
        endpoint: "ilink/bot/getupdates",
        body: {
          get_updates_buf: this.#syncBuf,
          base_info: baseInfo(this.#options.botAgent ?? DEFAULT_BOT_AGENT)
        },
        token: account.token,
        timeoutMs: clientTimeout,
        signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError" && !signal.aborted) {
        return { ret: 0, msgs: [], get_updates_buf: this.#syncBuf };
      }
      throw error;
    }
  }
  #failureDelay() {
    return this.#consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS;
  }
};
async function sendText(params) {
  const clientId = newClientId();
  const response = await apiCall({
    baseUrl: params.account.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: {
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: clientId,
        message_type: 2,
        // BOT
        message_state: 2,
        // FINISH
        item_list: params.text ? [{ type: 1, text_item: { text: params.text } }] : void 0,
        ...params.contextToken === void 0 ? {} : { context_token: params.contextToken },
        ...params.runId === void 0 ? {} : { run_id: params.runId }
      }
    },
    token: params.account.token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    signal: params.signal
  });
  assertSendAccepted(response);
  return {
    clientId,
    ...response.message_id === void 0 ? {} : { serverMessageId: response.message_id }
  };
}
function conversationKey(accountId, peerId, groupId) {
  return groupId ? `${accountId}:${groupId}:${peerId}` : `${accountId}:${peerId}`;
}
function toInbound(account, raw) {
  if (raw.message_type === 2) return void 0;
  const peerId = raw.from_user_id?.trim();
  if (!peerId) return void 0;
  const text = extractText(raw);
  const media = mediaItems(raw);
  if (!text && media.length === 0) return void 0;
  const conversationId = conversationKey(account.accountId, peerId, raw.group_id || void 0);
  return {
    accountId: account.accountId,
    peerId,
    ...raw.group_id ? { groupId: raw.group_id } : {},
    conversationId,
    ...raw.message_id === void 0 ? {} : { messageId: raw.message_id },
    ...raw.context_token === void 0 ? {} : { contextToken: raw.context_token },
    text,
    ...media.length === 0 ? {} : { media },
    raw,
    receivedAt: Date.now()
  };
}
function mediaItems(raw) {
  return (raw.item_list ?? []).filter((item) => isMediaItem(item));
}
function extractText(raw) {
  const parts = [];
  for (const item of raw.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) parts.push(item.text_item.text);
    else if (item.type === 3 && item.voice_item?.text) parts.push(item.voice_item.text);
  }
  return parts.join("\n").trim();
}
function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

// packages/core/src/session-index.ts
import { readdir, readFile as readFile2, stat } from "node:fs/promises";
import { join as join3 } from "node:path";
var CASE_INSENSITIVE_PATHS = process.platform === "win32" || process.platform === "darwin";
function isSameWorkspace(recorded, workspace, caseInsensitive = CASE_INSENSITIVE_PATHS) {
  const normalise = (value) => {
    const withSlashes = value.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    return caseInsensitive ? withSlashes.toLowerCase() : withSlashes;
  };
  return normalise(recorded) === normalise(workspace);
}
function indexKeyFor(sessionId) {
  return sessionId.replace(/^session-/, "");
}
function indexNamesFor(sessionId) {
  const bare = indexKeyFor(sessionId);
  return bare === sessionId ? [`${sessionId}.json`] : [`${sessionId}.json`, `${bare}.json`];
}
async function readIndex(storeDir, sessionId) {
  for (const name2 of indexNamesFor(sessionId)) {
    try {
      const raw = await readFile2(join3(storeDir, name2), "utf-8");
      const parsed = JSON.parse(raw);
      const title = parsed.record?.rows?.title?.val;
      const cwd = parsed.record?.identity?.cwd;
      return {
        title: typeof title === "string" ? title : "",
        cwd: typeof cwd === "string" ? cwd : ""
      };
    } catch {
    }
  }
  return { title: "", cwd: "" };
}
async function listAllStoredSessions(home) {
  const sessionsRoot = join3(home, "sessions");
  const indexDir = join3(home, "storages", "session_projcache", "sessions");
  let folders;
  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return /* @__PURE__ */ new Map();
  }
  const byWorkspace = /* @__PURE__ */ new Map();
  for (const folder of folders) {
    let ids;
    try {
      const entries = await readdir(join3(sessionsRoot, folder), { withFileTypes: true });
      ids = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("session-")).map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const sessionId of ids) {
      const [index, updatedAt] = await Promise.all([
        readIndex(indexDir, sessionId),
        newestMtime(join3(sessionsRoot, folder, sessionId))
      ]);
      const key = index.cwd;
      const list = byWorkspace.get(key);
      const entry = { sessionId, title: index.title, updatedAt, cwd: index.cwd };
      if (list === void 0) byWorkspace.set(key, [entry]);
      else list.push(entry);
    }
  }
  for (const list of byWorkspace.values()) list.sort((a, b) => b.updatedAt - a.updatedAt);
  return byWorkspace;
}
async function storedSessionWorkspace(home, sessionId) {
  const index = await readIndex(join3(home, "storages", "session_projcache", "sessions"), sessionId);
  return index.cwd === "" ? void 0 : index.cwd;
}
async function newestMtime(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let newest = 0;
    for (const entry of entries) {
      const info = await stat(join3(dir, entry.name));
      const at = info.mtimeMs;
      if (Number.isFinite(at) && at > newest) newest = at;
    }
    return newest;
  } catch {
    return 0;
  }
}

// packages/core/src/render.ts
var rendererPromise;
async function loadRenderer() {
  rendererPromise ??= (async () => {
    try {
      const loaded = await Promise.resolve().then(() => __toESM(require_lib(), 1));
      const candidate = loaded.default ?? loaded;
      if (typeof candidate?.toDataURL !== "function") {
        throw new Error("qrcode \u6A21\u5757\u6CA1\u6709 toDataURL \u5BFC\u51FA");
      }
      return candidate;
    } catch (error) {
      rendererPromise = void 0;
      throw new Error(
        `\u65E0\u6CD5\u52A0\u8F7D qrcode \u4F9D\u8D56\uFF1A${error instanceof Error ? error.message : String(error)}`
      );
    }
  })();
  return await rendererPromise;
}
async function toDataUrl(payload, size = 512) {
  try {
    const renderer = await loadRenderer();
    return await renderer.toDataURL(payload, { width: size, margin: 2 });
  } catch {
    return void 0;
  }
}

// packages/core/src/router.ts
import { randomUUID as randomUUID4 } from "node:crypto";
var SessionRouter = class {
  #gateway;
  #store;
  #titlePrefix;
  #bindings;
  constructor(options) {
    this.#gateway = options.gateway;
    this.#store = options.store;
    this.#titlePrefix = options.titlePrefix ?? "\u5FAE\u4FE1";
  }
  /**
   * Route one inbound message.
   *
   * @param params.conversationId - Stable conversation key.
   * @param params.accountId - Bot account the message arrived on.
   * @param params.peerId - Counterparty user id.
   * @param params.text - Message text.
   * @returns Either text to reply with directly, or a prompt for a session.
   */
  async route(params) {
    const text = params.text.trim();
    if (text.startsWith("/")) {
      return await this.#command(params, text);
    }
    const bindings = await this.#load();
    let binding = bindings[params.conversationId];
    let created = false;
    if (binding === void 0) {
      binding = await this.#bind(params, void 0);
      created = true;
    } else {
      await this.#gateway.ensureSession(binding.sessionId, binding.title);
    }
    binding.lastUsedAt = Date.now();
    await this.#store.save(bindings);
    return {
      kind: "prompt",
      decision: { sessionId: binding.sessionId, prompt: text, created }
    };
  }
  /** Currently bound session for a conversation, if any. */
  async current(conversationId) {
    return (await this.#load())[conversationId];
  }
  async #command(params, text) {
    const { command, args } = splitCommand(text);
    const bindings = await this.#load();
    switch (command) {
      case "/help":
        return { kind: "reply", text: HELP_TEXT };
      case "/new": {
        const binding = await this.#bind(params, args || void 0);
        bindings[params.conversationId] = binding;
        await this.#store.save(bindings);
        return {
          kind: "reply",
          text: `\u5DF2\u65B0\u5EFA\u5BF9\u8BDD\u300C${binding.title}\u300D\u3002
${shortId(binding.sessionId)}

\u4ECE\u73B0\u5728\u8D77\uFF0C\u4F60\u7684\u6D88\u606F\u53D1\u5230\u8FD9\u91CC\u3002`
        };
      }
      case "/list": {
        const all = await this.#gateway.listSessions();
        if (all.length === 0) return { kind: "reply", text: "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u5BF9\u8BDD\uFF0C\u76F4\u63A5\u53D1\u6D88\u606F\u5C31\u4F1A\u65B0\u5EFA\u4E00\u4E2A\u3002" };
        const currentId = bindings[params.conversationId]?.sessionId;
        const own = await this.#gateway.listOwnSessions?.() ?? all;
        const wantsAll = args.trim().toLowerCase() === "all";
        const shown = wantsAll ? all : own;
        const held = wantsAll ? [] : all.filter((session) => !own.includes(session));
        return {
          kind: "reply",
          text: renderSessionList(shown, currentId, { held })
        };
      }
      case "/switch": {
        const all = await this.#gateway.listSessions();
        const own = await this.#gateway.listOwnSessions?.() ?? all;
        const target = resolveTarget(args, all, own);
        if (target === void 0) {
          return { kind: "reply", text: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u5BF9\u8BDD\u3002\u56DE\u590D\u300C\u5217\u8868\u300D\u770B\u6E05\u5355\uFF0C\u518D\u56DE\u590D\u6570\u5B57\u3002" };
        }
        await this.#gateway.ensureSession(target.sessionId, target.title);
        const binding = {
          conversationId: params.conversationId,
          accountId: params.accountId,
          peerId: params.peerId,
          sessionId: target.sessionId,
          title: target.title || this.#titlePrefix,
          createdAt: bindings[params.conversationId]?.createdAt ?? Date.now(),
          lastUsedAt: Date.now()
        };
        bindings[params.conversationId] = binding;
        await this.#store.save(bindings);
        return { kind: "reply", text: `\u5DF2\u5207\u6362\u5230\u300C${binding.title}\u300D\u3002
${shortId(binding.sessionId)}` };
      }
      case "/current": {
        const binding = bindings[params.conversationId];
        if (binding === void 0) return { kind: "reply", text: "\u5F53\u524D\u6CA1\u6709\u5BF9\u8BDD\uFF0C\u53D1\u4EFB\u610F\u6D88\u606F\u5C31\u4F1A\u65B0\u5EFA\u4E00\u4E2A\u3002" };
        return {
          kind: "reply",
          text: `\u5F53\u524D\u5BF9\u8BDD\u300C${binding.title}\u300D
${shortId(binding.sessionId)}
\u6700\u540E\u4F7F\u7528\uFF1A${new Date(binding.lastUsedAt).toLocaleString("zh-CN")}`
        };
      }
      case "/cancel": {
        const binding = bindings[params.conversationId];
        if (binding === void 0) return { kind: "reply", text: "\u5F53\u524D\u6CA1\u6709\u5BF9\u8BDD\u3002" };
        await this.#gateway.cancel(binding.sessionId);
        return { kind: "reply", text: "\u5DF2\u8BF7\u6C42\u4E2D\u65AD\u5F53\u524D\u4EFB\u52A1\u3002" };
      }
      default:
        return { kind: "reply", text: `\u672A\u77E5\u6307\u4EE4 ${command}\u3002

${HELP_TEXT}` };
    }
  }
  /** Create a binding, its session, and persist it. */
  async #bind(params, requestedTitle) {
    const bindings = await this.#load();
    const sessionId = mintSessionId();
    const title = requestedTitle?.trim() || `${this.#titlePrefix} ${shortId(sessionId)}`;
    await this.#gateway.ensureSession(sessionId, title);
    const now = Date.now();
    const binding = {
      conversationId: params.conversationId,
      accountId: params.accountId,
      peerId: params.peerId,
      sessionId,
      title,
      createdAt: now,
      lastUsedAt: now
    };
    bindings[params.conversationId] = binding;
    await this.#store.save(bindings);
    return binding;
  }
  async #load() {
    this.#bindings ??= await this.#store.load();
    return this.#bindings;
  }
};
var COMMANDS_WITH_ARG = ["/new", "/switch"];
var COMMANDS_BARE = ["/help", "/list", "/current", "/cancel"];
function splitCommand(text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const space = trimmed.search(/\s/);
  if (space >= 0) {
    return { command: lower.slice(0, space), args: trimmed.slice(space + 1).trim() };
  }
  const colon = lower.indexOf(":");
  if (colon > 0) {
    return { command: lower.slice(0, colon), args: trimmed.slice(colon + 1).trim() };
  }
  if (COMMANDS_BARE.includes(lower)) {
    return { command: lower, args: "" };
  }
  for (const command of COMMANDS_WITH_ARG) {
    if (!lower.startsWith(command)) continue;
    const rest = trimmed.slice(command.length);
    if (/^[a-z]/.test(rest)) continue;
    return { command, args: rest.replace(/^[:\s]+/, "").trim() };
  }
  return { command: lower, args: "" };
}
function resolveTarget(args, sessions, numbered = sessions) {
  const value = args.trim();
  if (!value) return void 0;
  if (/^\d+$/.test(value)) {
    const byIndex = numbered[Number(value) - 1];
    if (byIndex !== void 0) return { sessionId: byIndex.sessionId, title: byIndex.title };
  }
  const exactId = sessions.find((session) => session.sessionId === value);
  if (exactId !== void 0) return { sessionId: exactId.sessionId, title: exactId.title };
  const byShort = sessions.filter((session) => session.sessionId.startsWith(`session-${value}-`));
  if (byShort.length === 1) return { sessionId: byShort[0].sessionId, title: byShort[0].title };
  const bySuffix = sessions.filter((session) => session.sessionId.endsWith(value));
  if (bySuffix.length === 1) return { sessionId: bySuffix[0].sessionId, title: bySuffix[0].title };
  const byTitle = sessions.find((session) => session.title === value);
  if (byTitle !== void 0) return { sessionId: byTitle.sessionId, title: byTitle.title };
  const core = (session) => session.title.includes(value) || value.includes(session.title);
  const byCore = sessions.filter((session) => session.title !== "" && core(session));
  if (byCore.length === 1) return { sessionId: byCore[0].sessionId, title: byCore[0].title };
  return void 0;
}
function mintSessionId(random = randomUUID4) {
  const uuid = random();
  const tail = uuid.replace(/-/g, "").slice(0, 8);
  return `session-${tail}-${uuid}`;
}
function shortId(sessionId) {
  const match = /^session-([0-9a-f]{8})-/i.exec(sessionId);
  if (match) return match[1];
  return sessionId.replace(/^session-/, "").slice(0, 8);
}
var LIST_LIMIT = 20;
function renderSessionRow(session, index, currentId) {
  const mark = session.sessionId === currentId ? "  \u2190 \u5F53\u524D" : "";
  const title = (session.title ?? "").trim() || "(\u65E0\u6807\u9898)";
  const when = session.updatedAt === void 0 ? "" : ` \xB7 ${relativeTime(session.updatedAt)}`;
  return `${index + 1}. ${title}${mark}
   ${shortId(session.sessionId)}${when}`;
}
function renderSessionList(sessions, currentId, options = {}) {
  const held = options.held ?? [];
  const shown = sessions.slice(0, LIST_LIMIT);
  const lines = shown.map((session, index) => renderSessionRow(session, index, currentId));
  const more = sessions.length > shown.length ? `

\uFF08\u8FD8\u6709 ${sessions.length - shown.length} \u4E2A\u66F4\u65E9\u7684\u5BF9\u8BDD\u672A\u663E\u793A\uFF09` : "";
  const elsewhere = held.length === 0 ? "" : `

\u53E6\u6709 ${String(held.length)} \u4E2A\u5BF9\u8BDD\u5728\u5176\u5B83\u5DE5\u4F5C\u533A\uFF0C${options.heldHint ?? "\u4E00\u8D77\u770B\u5C31\u53D1 /list all\u3002"}`;
  const all = sessions.length + held.length;
  return [
    `\u5171 ${String(all)} \u4E2A\u5BF9\u8BDD${held.length === 0 ? "" : `\uFF08\u8FD9\u91CC\u663E\u793A ${String(sessions.length)} \u4E2A\uFF09`}\uFF1A`,
    "",
    lines.join("\n\n"),
    more,
    elsewhere,
    "",
    "\u56DE\u590D\u6570\u5B57\u5373\u53EF\u5207\u6362\uFF0C\u4F8B\u5982\u300C3\u300D\u3002"
  ].join("\n");
}
function relativeTime(at, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1e3));
  if (seconds < 60) return "\u521A\u521A";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} \u5929\u524D`;
  return new Date(at).toLocaleDateString("zh-CN");
}
var HELP_TEXT = [
  "\u53EF\u7528\u6307\u4EE4\uFF1A",
  "/new [\u6807\u9898]     \u65B0\u5EFA\u5BF9\u8BDD",
  "/list           \u5217\u51FA\u6700\u8FD1\u5BF9\u8BDD",
  "/switch <\u7F16\u53F7>  \u5207\u6362\u5230\u67D0\u4E2A\u5BF9\u8BDD",
  "/current        \u663E\u793A\u5F53\u524D\u5BF9\u8BDD",
  "/cancel         \u4E2D\u65AD\u5F53\u524D\u4EFB\u52A1",
  "/help           \u663E\u793A\u672C\u5E2E\u52A9",
  "",
  "\u76F4\u63A5\u53D1\u6D88\u606F\u5373\u4E0E\u5F53\u524D\u5BF9\u8BDD\u5BF9\u8BDD\u3002",
  "",
  "\u4E5F\u53EF\u4EE5\u76F4\u63A5\u7528\u5927\u767D\u8BDD\u8BF4\uFF0C\u4F8B\u5982\u300C\u67E5\u770B\u5BF9\u8BDD\u5217\u8868\u300D\u300C\u6362\u4E2A\u5BF9\u8BDD\u300D\u300C\u505C\u4E0B\u300D\uFF0C",
  "\u6211\u4F1A\u5148\u95EE\u4F60\u4E00\u6B21\u786E\u8BA4\uFF0C\u786E\u8BA4\u540E\u624D\u6267\u884C\u3002"
].join("\n");

// packages/bundle/src/routes.ts
var ROUTE_PREFIX = "/.dsh-wechat-plugin";
var ROUTE_STATUS = `${ROUTE_PREFIX}/status`;
var ROUTE_TOGGLE = `${ROUTE_PREFIX}/toggle`;
var ROUTE_LOGIN_STATE = `${ROUTE_PREFIX}/login`;
var ROUTE_LOGIN_START = `${ROUTE_PREFIX}/login/start`;
var ROUTE_LOGIN_VERIFY = `${ROUTE_PREFIX}/login/verify`;
var ROUTE_LOGIN_CANCEL = `${ROUTE_PREFIX}/login/cancel`;
var ROUTE_SETTINGS = `${ROUTE_PREFIX}/settings`;
var ROUTE_DIAGNOSTICS = `${ROUTE_PREFIX}/diagnostics`;
var ROUTE_DISCONNECT = `${ROUTE_PREFIX}/disconnect`;
var ROUTE_CLIENT_ERROR = `${ROUTE_PREFIX}/client-error`;

// packages/bundle/src/media-kind.ts
var IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
var VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i;
function mediaKindOf(fileName) {
  if (IMAGE_EXTENSIONS.test(fileName)) return "image";
  if (VIDEO_EXTENSIONS.test(fileName)) return "video";
  return "file";
}
var MEDIA_TYPE_BY_KIND = {
  image: UploadMediaType.IMAGE,
  video: UploadMediaType.VIDEO,
  file: UploadMediaType.FILE
};
var MEDIA_LABEL_BY_KIND = {
  image: "\u56FE\u7247",
  video: "\u89C6\u9891",
  file: "\u6587\u4EF6"
};

// packages/bundle/src/interactions.ts
var ALLOW_WORDS = ["\u5141\u8BB8", "\u540C\u610F", "\u53EF\u4EE5", "\u597D", "\u884C", "yes", "y", "allow", "ok", "okay"];
var DENY_WORDS = ["\u62D2\u7EDD", "\u4E0D\u5141\u8BB8", "\u4E0D\u884C", "\u4E0D\u8981", "\u5426", "no", "n", "deny", "reject", "cancel", "\u53D6\u6D88"];
function parseApprovalReply(reply) {
  const text = reply.trim().toLowerCase();
  if (text === "") return void 0;
  if (DENY_WORDS.some((word) => text === word || text.startsWith(`${word} `))) return "rejected";
  if (ALLOW_WORDS.some((word) => text === word || text.startsWith(`${word} `))) return "allowed-once";
  return void 0;
}
function presentApproval(request) {
  const toolName = typeof request.toolName === "string" ? request.toolName : "\u67D0\u4E2A\u64CD\u4F5C";
  const reason = [request.displayReason, request.reason, request.command].find(
    (value) => typeof value === "string" && value !== ""
  );
  const lines = [`\u{1F510} \u9700\u8981\u4F60\u786E\u8BA4\uFF1A${toolName}`];
  if (typeof reason === "string") lines.push(reason, "");
  else lines.push("");
  lines.push("\u56DE\u590D \u5141\u8BB8 \u6216 \u62D2\u7EDD");
  return { body: lines.join("\n") };
}
function presentQuestions(questions) {
  const blocks = [];
  for (const [index, item] of questions.entries()) {
    const lines = [];
    if (questions.length > 1) lines.push(`${String(index + 1)}. ${item.question}`);
    else lines.push(item.question);
    if (item.detail !== void 0 && item.detail !== "") lines.push(item.detail);
    if (item.options !== void 0 && item.options.length > 0) {
      lines.push("");
      for (const [optionIndex, option] of item.options.entries()) {
        const suffix = option.description === void 0 ? "" : ` \u2014 ${option.description}`;
        lines.push(`${String(optionIndex + 1)}. ${option.label}${suffix}`);
      }
      lines.push("");
      const many = item.multiSelect === true;
      lines.push(many ? "\u56DE\u590D\u7F16\u53F7\uFF08\u53EF\u591A\u4E2A\uFF0C\u5982 1,3\uFF09\uFF0C\u6216\u76F4\u63A5\u56DE\u590D\u4F60\u7684\u7B54\u6848" : "\u56DE\u590D\u7F16\u53F7\uFF0C\u6216\u76F4\u63A5\u56DE\u590D\u4F60\u7684\u7B54\u6848");
    } else {
      lines.push("");
      lines.push("\u76F4\u63A5\u56DE\u590D\u4F60\u7684\u7B54\u6848");
    }
    blocks.push(lines.join("\n"));
  }
  return { body: blocks.join("\n\n") };
}
function parseQuestionReply(questions, reply) {
  const text = reply.trim();
  const answers = questions.map((item) => {
    const options = item.options ?? [];
    const indices = readIndices(text, options.length);
    if (indices.length > 0) {
      const selected = indices.map((index) => options[index]?.label ?? "");
      const multi = item.multiSelect === true ? selected : selected.slice(0, 1);
      return { id: item.id, selected: multi.filter((label) => label !== "") };
    }
    if (options.length === 0) return { id: item.id, selected: [], custom: text };
    const matched = options.find((option) => option.label === text);
    return matched === void 0 ? { id: item.id, selected: [], custom: text } : { id: item.id, selected: [matched.label] };
  });
  return { answers };
}
function readIndices(text, optionCount) {
  if (optionCount === 0) return [];
  if (!/^[\d\s,，、]+$/.test(text)) return [];
  const numbers = text.split(/[\s,，、]+/).filter((part) => part !== "");
  const indices = [];
  for (const part of numbers) {
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 1 || value > optionCount) return [];
    indices.push(value - 1);
  }
  return indices;
}

// packages/bundle/src/services.ts
function readStreamFrame(payload) {
  const rawId = payload.agent?.session?.id;
  const sessionId = typeof rawId === "string" ? rawId : void 0;
  const withId = sessionId === void 0 ? {} : { sessionId };
  const frame = payload.frame;
  if (typeof frame !== "object" || frame === null) return withId;
  const record = frame;
  if (record.type === "end") return { ...withId, completed: true };
  const chunk = record.chunk;
  if (typeof chunk !== "object" || chunk === null) {
    return {
      ...withId,
      frameShape: `frame:${Object.keys(record).join(",")};type=${String(record.type)}`
    };
  }
  const item = chunk;
  const observed = { ...withId, chunkType: String(item.type) };
  switch (item.type) {
    case "text-delta":
      return typeof item.text === "string" ? { ...withId, text: item.text, ...observed } : observed;
    case "tool-call-delta": {
      const id = typeof item.id === "string" ? item.id : void 0;
      const name2 = typeof item.name === "string" ? item.name : void 0;
      if (id === void 0 || name2 === void 0 || name2 === "") {
        return { ...withId, toolCallShape: Object.keys(item).join(","), ...observed };
      }
      return { ...withId, toolCall: { id, name: name2 }, ...observed };
    }
    case "block-start":
    case "block-end":
      return {
        ...withId,
        blockShape: `${String(item.type)}:${Object.keys(item).join(",")}`,
        ...observed
      };
    default:
      return observed;
  }
}

// packages/bundle/src/host.ts
var name = "dsh-wechat-plugin";
var inject = ["sessionController", "sessions", "workspaceRegistry", "tools"];
var TOOL_CARD_GRACE_MS = 1500;
var MAX_REPLY_CHARS = 4e3;
var LOGIN_RESULT_TTL_MS = 3e4;
var TYPING_REFRESH_MS = 5e3;
var TYPING_MAX_MS = 30 * 60 * 1e3;
var WORKSPACE_DIR_NAME = "dsh_wechat";
var WORKSPACE_TITLE = "\u5FAE\u4FE1\u4F1A\u8BDD";
var MEDIA_DIR_NAME = "\u5A92\u4F53";
var BOOT_LOG_NAME = "boot.log";
function sessionToolDescription(requireConfirmation) {
  const base = "Manage which WeChat conversation (session) this channel is talking to. Call this whenever the user asks to see their conversations, switch between them, start a new one, find out which one is in use, or stop what is running \u2014 in any wording. Do not merely describe these actions in a reply; call the tool. The user is on a phone and cannot see the desktop session list. Switching and creating are announced to the user by the channel \u2014 including when they fail \u2014 so do not repeat that outcome either way. Never tell the user a switch or a new conversation succeeded; read the result's `ok` field and, if it is false, say nothing about it because the channel has already told them what went wrong. The list shows this channel's own conversations by default and reports how many others exist in other workspaces; when the user asks to see those as well, call list again with target \"all\". Any conversation in the full list can be switched to, whichever workspace it is in.";
  if (requireConfirmation) {
    return `${base} IMPORTANT: before acting, state what you are about to do and wait for the user to agree; only then call this tool. The exception is action "list", which changes nothing and may be called straight away.`;
  }
  return `${base} The user has turned confirmation off, so act on the request directly.`;
}
function switchConfirmation(action, resolvedTitle) {
  const title = resolvedTitle.trim();
  if (action === "new") {
    return title === "" ? "\u5DF2\u65B0\u5EFA\u5BF9\u8BDD\uFF0C\u4ECE\u73B0\u5728\u8D77\u4F60\u7684\u6D88\u606F\u53D1\u5230\u8FD9\u91CC\u3002" : `\u5DF2\u65B0\u5EFA\u5BF9\u8BDD\u300C${title}\u300D\uFF0C\u4ECE\u73B0\u5728\u8D77\u4F60\u7684\u6D88\u606F\u53D1\u5230\u8FD9\u91CC\u3002`;
  }
  return title === "" ? "\u5DF2\u5207\u6362\u5BF9\u8BDD\u3002" : `\u5DF2\u5207\u6362\u5230\u300C${title}\u300D\u3002`;
}
function switchFailure(action, target, reason) {
  const headline = reason.split("\n")[0]?.trim() ?? "";
  const what = action === "switch" ? target === void 0 || target === "" ? "\u5207\u6362\u5BF9\u8BDD" : `\u5207\u6362\u5230\u300C${target}\u300D` : "\u65B0\u5EFA\u5BF9\u8BDD";
  return `${what}\u6CA1\u6709\u6210\u529F\u3002${headline}

\u53D1\u300C/list\u300D\u770B\u6E05\u5355\uFF0C\u76F4\u63A5\u56DE\u6570\u5B57\u4E5F\u80FD\u5207\u3002`;
}
function renderTable(sessions, currentId) {
  return sessions.map((row, index) => renderSessionRow(row, index, currentId)).join("\n\n");
}
function workspaceLabel(path) {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  return parts.at(-1) ?? path;
}
var EMPTY_STATE2 = {
  version: 1,
  accounts: {},
  syncBufs: {},
  contextTokens: {},
  bindings: {},
  sentMessages: {}
};
function storeMedia(home, media) {
  const dir = join4(home, WORKSPACE_DIR_NAME, MEDIA_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const safe = media.fileName.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = join4(dir, `${Date.now().toString(36)}-${randomUUID5().slice(0, 8)}-${safe}`);
  writeFileSync(path, media.data);
  return path;
}
function sessionIdOf(agent) {
  if (typeof agent !== "object" || agent === null) return void 0;
  const candidate = agent.session?.id;
  return typeof candidate === "string" ? candidate : void 0;
}
var SENDER_BY_KIND = {
  image: sendImage,
  video: sendVideo,
  file: sendFile
};
function describeMedia(media, path) {
  const size = media.data.length;
  const readable = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
  const kind = { image: "\u56FE\u7247", file: "\u6587\u4EF6", voice: "\u8BED\u97F3", video: "\u89C6\u9891" }[media.kind];
  const parts = [`[${kind}] ${path} (${readable})`];
  if (media.durationMs !== void 0) {
    parts.push(`\u65F6\u957F\uFF1A${(media.durationMs / 1e3).toFixed(1)} \u79D2`);
  }
  if (media.kind === "voice" && media.contentType === "audio/silk") {
    parts.push("\uFF08\u672A\u80FD\u8F6C\u7801\u4E3A WAV\uFF0C\u4ECD\u662F\u539F\u59CB SILK\uFF09");
  }
  if (media.transcript !== void 0 && media.transcript !== "") {
    parts.push(`\u670D\u52A1\u7AEF\u8F6C\u5199\uFF1A${media.transcript}`);
  }
  return parts.join("\n");
}
var WechatRuntime = class {
  #ctx;
  #store;
  /** Path of the state file, kept for the one synchronous settings read. */
  #stateFilePath;
  #router;
  #botAgent;
  #workspace;
  #home;
  #send;
  /** One monitor per account, plus its abort controller. */
  #monitors = /* @__PURE__ */ new Map();
  /** The running login handshake, if any. */
  #loginTask;
  /** Buffered assistant text per session, plus the conversation it belongs to. */
  #replies = /* @__PURE__ */ new Map();
  /** Recent errors, surfaced in the settings page. */
  #errors = [];
  /** Non-text messages awaiting an instruction, keyed by conversation. */
  #pending = /* @__PURE__ */ new Map();
  /**
   * Conversations currently showing "typing…", with the timers that keep it up.
   *
   * Keyed by conversation so a second message in the same chat does not start a second refresh loop,
   * and cleared by the reply rather than by the inbound handler — see {@link #startTyping}.
   */
  #typing = /* @__PURE__ */ new Map();
  /**
   * Interactions waiting on a WeChat reply, keyed by conversation.
   *
   * A permission prompt or a multiple-choice question is normally answered in the desktop's
   * conversation pane. Someone whose only device is the phone never sees that pane, and the
   * harness's own answerer fails closed, so the turn would stall. These entries let the channel
   * answer on their behalf: the prompt goes out over WeChat and the next reply settles it.
   */
  #interactions = /* @__PURE__ */ new Map();
  /**
   * Tool calls already announced, keyed `sessionId\u0000callId`.
   *
   * A tool-call-delta arrives once per argument fragment, so without this the card would be
   * re-sent for every fragment of the same call.
   */
  #announcedTools = /* @__PURE__ */ new Set();
  /** Running tool calls, keyed the same way, so the result card can name the tool. */
  #runningTools = /* @__PURE__ */ new Map();
  /** Observations already written to the log, bucketed so each distinct value logs once. */
  #seenShapes = /* @__PURE__ */ new Map();
  /**
   * Cached settings, so the synchronous assistant-stream path can read them.
   *
   * `undefined` means "not read yet"; {@link saveSettings} replaces it.
   */
  #settingsCache;
  #needsLogin = false;
  /** Resolved Workspace id, cached once the registry answers. */
  #workspaceId;
  /**
   * Disposer for the `session_control` registration.
   *
   * Held so the tool can be re-registered when the confirmation setting changes: the registry
   * takes the description by value, so a stale description would leave the setting inert.
   */
  #sessionToolDisposer;
  /** Set once the plugin is torn down, so a late async registration does not resurrect a tool. */
  #disposed = false;
  constructor(ctx, options) {
    this.#ctx = ctx;
    this.#botAgent = options.botAgent;
    this.#workspace = options.workspace;
    this.#home = options.home;
    this.#send = options.send ?? (async ({ account, to, text, contextToken }) => await sendText({
      account,
      to,
      text,
      ...contextToken === void 0 ? {} : { contextToken }
    }));
    this.#store = new StateStore(options.stateFile);
    this.#stateFilePath = options.stateFile;
    const bindings = {
      load: async () => (await this.#store.read()).bindings,
      save: async (next) => {
        await this.#store.update((state) => {
          state.bindings = next;
        });
      }
    };
    this.#router = new SessionRouter({ gateway: this.#gateway(), store: bindings });
  }
  /** Read the persisted state. */
  state() {
    return this.#store.read();
  }
  /** Whether the channel is armed to reconnect on boot. */
  async enabled() {
    return (await this.#store.read()).autoStart === true;
  }
  /** Current status for the settings page. */
  async status() {
    const state = await this.#store.read();
    return {
      enabled: state.autoStart === true,
      accounts: Object.values(state.accounts).map((account) => ({
        accountId: account.accountId,
        ...account.userId === void 0 ? {} : { userId: account.userId },
        polling: this.#monitors.has(account.accountId)
      })),
      needsLogin: this.#needsLogin,
      errors: [...this.#errors].slice(-10),
      diagnostics: {
        logPath: join4(this.#home, "wechat", BOOT_LOG_NAME),
        statePath: this.#store.file,
        workspace: join4(this.#home, WORKSPACE_DIR_NAME),
        logTail: this.#bootLogTail()
      }
    };
  }
  /**
   * Last lines of the boot log, oldest first.
   *
   * Read on demand and bounded: the file grows without limit, and the settings page only ever
   * shows the end of it.
   */
  #bootLogTail(limit = 200) {
    try {
      const text = readFileSync(join4(this.#home, "wechat", BOOT_LOG_NAME), "utf8");
      return text.split(/\r?\n/).filter((line) => line !== "").slice(-limit);
    } catch {
      return [];
    }
  }
  /** Every binding that is still usable, plus the accounts it belongs to. */
  async bindings() {
    return Object.values((await this.#store.read()).bindings);
  }
  /**
   * Perform a session action on behalf of the agent.
   *
   * This is the whole of the natural-language path. An earlier attempt recognised phrasings with
   * regular expressions and recognised almost nothing — «换个对话», «刚才那个», «切到第二个» all
   * missed — because the set of ways a person can ask is not enumerable. The agent reads the
   * message anyway and does understand it, so the judgement is delegated to it and the channel
   * only has to carry the action out.
   *
   * Every action is executed through the router's own command path, so there is one implementation
   * of each and the typed and spoken routes cannot drift apart.
   *
   * @param callerSessionId - Session the calling agent is in, which identifies the conversation.
   * @param action - What to do.
   * @param target - Session to switch to, when the action needs one.
   * @returns A result the agent can report, or a reason it could not be done.
   */
  async controlSession(callerSessionId, action, target) {
    const conversationId = await this.#conversationForAgentSession(callerSessionId);
    if (conversationId === void 0) {
      return {
        ok: false,
        detail: "\u8FD9\u4E2A\u4F1A\u8BDD\u6CA1\u6709\u7ED1\u5B9A\u4EFB\u4F55\u5FAE\u4FE1\u5BF9\u8BDD\uFF0C\u65E0\u6CD5\u64CD\u4F5C\u3002",
        sessions: [],
        otherWorkspaces: 0,
        otherNames: []
      };
    }
    const binding = (await this.#store.read()).bindings[conversationId];
    if (binding === void 0) {
      return {
        ok: false,
        detail: "\u8FD9\u4E2A\u4F1A\u8BDD\u6CA1\u6709\u7ED1\u5B9A\u4EFB\u4F55\u5FAE\u4FE1\u5BF9\u8BDD\uFF0C\u65E0\u6CD5\u64CD\u4F5C\u3002",
        sessions: [],
        otherWorkspaces: 0,
        otherNames: []
      };
    }
    const text = action === "switch" ? `/switch ${target ?? ""}` : action === "new" && target !== void 0 && target !== "" ? `/new ${target}` : `/${action}`;
    const result = await this.#router.route({
      conversationId,
      accountId: binding.accountId,
      peerId: binding.peerId,
      text
    });
    if (result.kind !== "reply") {
      return {
        ok: false,
        detail: `\u4E0D\u652F\u6301\u7684\u64CD\u4F5C\uFF1A${action}`,
        sessions: [],
        otherWorkspaces: 0,
        otherNames: []
      };
    }
    const includeAll = target === "all";
    const table = await this.#sessionTable(conversationId, includeAll);
    const { sessions, otherWorkspaces, otherNames } = table;
    const failed = /找不到|未知指令/.test(result.text);
    if (action === "switch" || action === "new") {
      if (failed) {
        await this.#notify(conversationId, switchFailure(action, target, result.text));
      } else {
        const after = (await this.#store.read()).bindings[conversationId];
        await this.#notify(conversationId, switchConfirmation(action, after?.title ?? ""));
      }
    }
    if (failed) {
      return {
        ok: false,
        // Stated as done, because it was: the user has been told directly, and a retelling can only
        // contradict what they already read.
        detail: `\u5207\u6362\u5931\u8D25\uFF0C\u5DF2\u76F4\u63A5\u544A\u8BC9\u7528\u6237\u3002\u539F\u56E0\uFF1A${result.text.split("\n")[0] ?? ""}`,
        sessions,
        otherWorkspaces,
        otherNames
      };
    }
    if (action === "list" || action === "current") {
      const currentId = sessions.find((row) => row.current)?.sessionId;
      const body = sessions.length === 0 ? "\u8FD8\u6CA1\u6709\u5176\u4ED6\u5BF9\u8BDD\u3002" : [
        includeAll ? `\u5171 ${String(sessions.length)} \u4E2A\u5BF9\u8BDD\uFF08\u542B\u5176\u5B83\u5DE5\u4F5C\u533A\uFF09\uFF1A` : `\u5171 ${String(sessions.length + otherWorkspaces)} \u4E2A\u5BF9\u8BDD${otherNames.length === 0 ? "" : `\uFF08\u8FD9\u91CC\u663E\u793A ${String(sessions.length)} \u4E2A\uFF09`}\uFF1A`,
        "",
        renderTable(sessions, currentId),
        otherNames.length === 0 ? "" : `
\u53E6\u6709 ${String(otherWorkspaces)} \u4E2A\u5BF9\u8BDD\u5728\u522B\u7684\u5DE5\u4F5C\u533A\uFF08${otherNames.join("\u3001")}\uFF09\u3002\u8BF4\u300C\u770B\u5168\u90E8\u5BF9\u8BDD\u300D\u5C31\u80FD\u4E00\u8D77\u770B\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5207\u8FC7\u53BB\u3002`,
        "",
        "\u56DE\u590D\u6570\u5B57\u5373\u53EF\u5207\u6362\uFF0C\u4F8B\u5982\u300C3\u300D\u3002"
      ].filter((part) => part !== "").join("\n");
      await this.#notify(conversationId, body);
      return {
        ok: true,
        // The agent gets told what happened, not the list itself: repeating it would double every
        // request, and paraphrasing it is what produced a list the user could not act on.
        detail: `\u5217\u8868\u5DF2\u76F4\u63A5\u53D1\u7ED9\u7528\u6237\uFF08\u5171 ${String(sessions.length)} \u4E2A\u5BF9\u8BDD\uFF09\u3002\u4E0D\u8981\u91CD\u590D\u8FD9\u4EFD\u5217\u8868\u3002`,
        sessions,
        otherWorkspaces,
        otherNames
      };
    }
    return { ok: true, detail: result.text, sessions, otherWorkspaces, otherNames };
  }
  /**
   * Send one message to a conversation, on the channel's own behalf.
   *
   * Used where the user must be told something regardless of what the agent chooses to say. Failure
   * is recorded, not thrown: a missed confirmation must not fail the action it was confirming.
   *
   * @param conversationId - Conversation to notify.
   * @param text - Message body.
   */
  async #notify(conversationId, text) {
    const state = await this.#store.read();
    const binding = state.bindings[conversationId];
    if (binding === void 0) return;
    const account = state.accounts[binding.accountId];
    if (account === void 0) return;
    try {
      await this.#send({
        account,
        to: binding.peerId,
        text
      });
      this.#recordBoot(`session notice sent: ${text.split("\n")[0] ?? ""}`);
    } catch (error) {
      this.#recordError(
        `\u53D1\u9001\u4F1A\u8BDD\u901A\u77E5\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * The sessions a conversation can move between, numbered the way the list presents them.
   *
   * The agent gets this alongside every result so it can offer the choice it just described
   * without a second call.
   *
   * @param conversationId - Conversation whose current session is marked.
   * @param includeAll - Whether to include sessions from other workspaces.
   * @returns Rows ready to relay, how many were held back, and where those live.
   */
  async #sessionTable(conversationId, includeAll) {
    const state = await this.#store.read();
    const current = state.bindings[conversationId];
    const currentId = current?.sessionId ?? "";
    const listed = await this.#gateway().listSessions();
    const own = [];
    const others = [];
    const otherPaths = /* @__PURE__ */ new Set();
    for (const session of listed) {
      const path = await storedSessionWorkspace(this.#home, session.sessionId);
      if (path === void 0 || isSameWorkspace(path, this.#workspace)) own.push(session);
      else {
        others.push(session);
        otherPaths.add(path);
      }
    }
    if (listed.length === 0) {
      return {
        sessions: current === void 0 ? [] : [
          {
            index: 1,
            sessionId: current.sessionId,
            title: current.title.trim() || "(\u65E0\u6807\u9898)",
            updatedAt: current.lastUsedAt,
            current: true
          }
        ],
        otherWorkspaces: 0,
        otherNames: []
      };
    }
    const chosen = includeAll ? [...own, ...others] : own;
    const ordered = [...chosen].sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      sessions: ordered.map((session, index) => ({
        index: index + 1,
        sessionId: session.sessionId,
        title: session.title.trim() || "(\u65E0\u6807\u9898)",
        updatedAt: session.updatedAt,
        current: session.sessionId === currentId
      })),
      otherWorkspaces: includeAll ? 0 : others.length,
      // Folder names, because they are what the user recognises from the desktop. Named rather than
      // counted so "which other lists are there" needs no second question.
      otherNames: includeAll ? [] : [...otherPaths].map(workspaceLabel).sort()
    };
  }
  /**
   * Tuned settings plus the defaults they fall back to, for the settings page.
   *
   * Both are sent whole: the page shows the effective value of every setting and offers a reset
   * to the defaults, so it needs to know both.
   */
  async settingsForPage() {
    return {
      settings: await this.#settings(),
      defaults: resolveSettings(EMPTY_STATE2)
    };
  }
  /**
   * Disconnect one WeChat account from this machine.
   *
   * Stops its poll and **forgets its credentials**, which is what makes this different from
   * switching the channel off: the channel switch only stops listening and can be turned back on,
   * while this ends the link and requires scanning again to restore it.
   *
   * The account's conversations are forgotten too. Their DSH sessions are untouched — the session
   * is the work, and this only ends the WeChat side of it — so nothing anyone said is lost.
   *
   * @param accountId - Account to disconnect.
   * @returns Whether an account was found and removed.
   */
  async disconnect(accountId) {
    const running = this.#monitors.get(accountId);
    if (running !== void 0) {
      running.abort.abort();
      void running.monitor.notifyStop();
      this.#monitors.delete(accountId);
    }
    let found = false;
    await this.#store.update((state) => {
      if (state.accounts[accountId] === void 0) return;
      found = true;
      delete state.accounts[accountId];
      delete state.syncBufs[accountId];
      delete state.contextTokens[accountId];
      delete state.sentMessages[accountId];
      for (const [key, binding] of Object.entries(state.bindings)) {
        if (binding.accountId === accountId) delete state.bindings[key];
      }
      if (Object.keys(state.accounts).length === 0) state.autoStart = false;
    });
    if (found) this.#recordBoot(`disconnected account ${accountId}`);
    return found;
  }
  /**
   * Per-account poll detail.
   *
   * Distinguishes an account whose poll is live from one whose monitor exists but has stopped —
   * the summary status cannot tell those apart, and with several accounts bound that is the
   * difference between "still working" and "silently dead".
   */
  async accountDetail() {
    const state = await this.#store.read();
    return Object.values(state.accounts).map((account) => ({
      accountId: account.accountId,
      ...account.userId === void 0 ? {} : { userId: account.userId },
      polling: this.#monitors.has(account.accountId),
      credentialsUsable: !this.#needsLogin,
      bindings: Object.values(state.bindings).filter(
        (binding) => binding.accountId === account.accountId
      ).length
    }));
  }
  /** Current login task state. */
  loginState() {
    return this.#loginTask?.state ?? { phase: "idle" };
  }
  /** Turn the channel on or off and persist the choice. */
  async setEnabled(enabled) {
    await this.#store.update((state) => {
      state.autoStart = enabled;
    });
    if (enabled) await this.start();
    else await this.stop();
  }
  /** Start a monitor for every stored account. Safe to call repeatedly. */
  async start() {
    const state = await this.#store.read();
    const accounts = Object.values(state.accounts);
    if (accounts.length > 0) this.#needsLogin = false;
    for (const account of accounts) await this.#startMonitor(account);
  }
  /** Stop monitoring and tell the service we are going away. */
  async stop() {
    for (const { monitor, abort } of this.#monitors.values()) {
      abort.abort();
      void monitor.notifyStop();
    }
    this.#monitors.clear();
  }
  /** Tear everything down for plugin disposal. */
  async halt() {
    for (const entry of this.#replies.values()) clearTimeout(entry.timer);
    this.#replies.clear();
    this.#clearParked();
    this.#loginTask?.controller.abort();
    this.#loginTask = void 0;
    await this.stop();
  }
  /**
   * Feed one inbound message through the channel's real pipeline.
   *
   * Exposed so tests — and any future in-process source of messages — can drive the
   * same path a WeChat delivery takes, without standing up a long poll.
   */
  async ingest(message) {
    await this.#handleInbound(message);
  }
  /**
   * Run one login handshake to completion, driving the generator.
   *
   * The task outlives the HTTP request that started it, so the user can reload the
   * settings page — or close it — while still on the phone confirming the scan.
   */
  async startLogin() {
    if (this.#loginTask !== void 0) return this.#loginTask.state;
    const state = await this.#store.read();
    const existingTokens = Object.values(state.accounts).map((account) => account.token).filter((token) => token.length > 0);
    const controller = new AbortController();
    const task = {
      controller,
      state: { phase: "running", step: "\u6B63\u5728\u83B7\u53D6\u4E8C\u7EF4\u7801\u2026" }
    };
    this.#loginTask = task;
    void (async () => {
      try {
        const iterator = login(
          { existingTokens, reuseExisting: "adopt" },
          controller.signal
        );
        let input;
        for (; ; ) {
          const next = await iterator.next(input);
          if (next.done === true) {
            const result = next.value;
            if (result.account !== void 0) {
              await this.#adoptAccount(result.account);
              task.state = {
                phase: "succeeded",
                step: "\u5DF2\u8FDE\u63A5\u5FAE\u4FE1",
                accountId: result.account.accountId
              };
            } else if (result.alreadyBound) {
              task.state = { phase: "already-bound", step: "\u8BE5\u5FAE\u4FE1\u8D26\u53F7\u6B64\u524D\u5DF2\u7ED1\u5B9A\uFF0C\u6CBF\u7528\u539F\u6709\u51ED\u636E" };
            } else {
              task.state = {
                phase: "failed",
                step: "\u767B\u5F55\u672A\u5B8C\u6210",
                error: result.reason ?? "\u672A\u77E5\u539F\u56E0"
              };
            }
            return;
          }
          input = await this.#applyLoginEvent(task.state, next.value);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#recordError(`\u767B\u5F55\u5931\u8D25: ${message}`);
        task.state = { phase: "failed", step: "\u767B\u5F55\u5931\u8D25", error: message };
      } finally {
        if (this.#loginTask === task) {
          const timer = setTimeout(() => {
            if (this.#loginTask === task) this.#loginTask = void 0;
          }, LOGIN_RESULT_TTL_MS);
          timer.unref?.();
        }
      }
    })();
    return task.state;
  }
  /** Answer a verification-code prompt. Returns false when nothing is waiting. */
  provideVerifyCode(code) {
    const task = this.#loginTask;
    if (task?.answer === void 0) return false;
    const answer = task.answer;
    task.answer = void 0;
    task.state = { ...task.state, awaitingVerifyCode: false, step: "\u6B63\u5728\u6821\u9A8C\u9A8C\u8BC1\u7801\u2026" };
    answer(code);
    return true;
  }
  /** Abandon the running login task. */
  cancelLogin() {
    this.#loginTask?.controller.abort();
    this.#loginTask = void 0;
  }
  /** Apply one handshake event to the visible state, returning generator input. */
  async #applyLoginEvent(state, event) {
    switch (event.kind) {
      case "qr": {
        const qrDataUrl = await toDataUrl(event.qrUrl);
        Object.assign(state, {
          phase: "running",
          step: event.refreshed ? "\u4E8C\u7EF4\u7801\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801" : "\u8BF7\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u7801",
          qrUrl: event.qrUrl,
          ...qrDataUrl === void 0 ? {} : { qrDataUrl },
          awaitingVerifyCode: false,
          refreshed: event.refreshed ? (state.refreshed ?? 0) + 1 : 0
        });
        return void 0;
      }
      case "scanned":
        Object.assign(state, { step: "\u5DF2\u626B\u7801\uFF0C\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4" });
        return void 0;
      case "redirected":
        Object.assign(state, { step: `\u670D\u52A1\u7AEF\u8981\u6C42\u5207\u6362\u673A\u623F\uFF1A${event.host}` });
        return void 0;
      case "expired":
        Object.assign(state, {
          step: event.willRetry ? "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u6B63\u5728\u5237\u65B0\u2026" : "\u4E8C\u7EF4\u7801\u591A\u6B21\u8FC7\u671F"
        });
        return void 0;
      case "failed":
        Object.assign(state, { phase: "failed", step: "\u767B\u5F55\u5931\u8D25", error: event.reason });
        return void 0;
      case "already-bound":
        Object.assign(state, { phase: "already-bound", step: "\u8BE5\u5FAE\u4FE1\u8D26\u53F7\u6B64\u524D\u5DF2\u7ED1\u5B9A" });
        return void 0;
      case "confirmed":
        return void 0;
      case "verifycode-required": {
        Object.assign(state, { step: "\u670D\u52A1\u7AEF\u8981\u6C42\u8F93\u5165\u914D\u5BF9\u9A8C\u8BC1\u7801", awaitingVerifyCode: true });
        const task = this.#loginTask;
        if (task === void 0) return void 0;
        return await new Promise((resolve) => {
          task.answer = resolve;
        });
      }
      default:
        return void 0;
    }
  }
  /** Persist a freshly issued account and start polling it. */
  async #adoptAccount(account) {
    await this.#store.update((state) => {
      state.accounts[account.accountId] = account;
      delete state.syncBufs[account.accountId];
    });
    this.#needsLogin = false;
    await this.#startMonitor(account);
  }
  /** Start the long poll for one account, unless it is already running. */
  async #startMonitor(account) {
    if (this.#monitors.has(account.accountId)) return;
    const monitor = new ChannelMonitor({
      account,
      botAgent: this.#botAgent,
      onMessage: async (message) => {
        await this.#handleInbound(message);
      },
      onSyncBuf: async (buf) => {
        await this.#store.update((state2) => {
          state2.syncBufs[account.accountId] = buf;
        });
      },
      onError: (error) => {
        this.#recordError(error instanceof Error ? error.message : String(error));
      },
      onStop: (reason) => {
        this.#monitors.delete(account.accountId);
        if (reason === "stale-token") {
          this.#needsLogin = true;
          this.#recordError(`\u8D26\u53F7 ${account.accountId} \u7684 token \u5DF2\u5931\u6548\uFF0C\u9700\u8981\u91CD\u65B0\u626B\u7801`);
        }
      }
    });
    const state = await this.#store.read();
    const saved = state.syncBufs[account.accountId];
    if (saved) monitor.restoreSyncBuf(saved);
    const abort = new AbortController();
    this.#monitors.set(account.accountId, { monitor, abort });
    void monitor.run(abort.signal);
  }
  /**
   * Current tuned settings, with defaults filled in.
   *
   * Cached, and invalidated by {@link saveSettings}. The assistant-stream handler needs them
   * synchronously: awaiting a store read inside a frame handler opens an async gap between two
   * frames of the same answer, and the second frame then finds no buffered entry and starts a
   * fresh one — which silently drops the first half of every reply.
   */
  async #settings() {
    this.#settingsCache ??= resolveSettings(await this.#store.read());
    return this.#settingsCache;
  }
  /** Settings for a synchronous caller, falling back to the stored defaults. */
  #settingsNow() {
    return this.#settingsCache ?? resolveSettings(EMPTY_STATE2);
  }
  /**
   * Read the stored settings synchronously.
   *
   * Needed by exactly one caller: the tool registration, which happens during the synchronous
   * `apply` and has to see what the user actually chose. Everything else reads through
   * {@link #settings}, which awaits the store. A missing or unreadable file falls back to the
   * defaults, exactly as a first run would.
   *
   * @returns The effective settings.
   */
  #settingsFromDisk() {
    if (this.#settingsCache !== void 0) return this.#settingsCache;
    let settings;
    try {
      const parsed = JSON.parse(readFileSync(this.#stateFilePath, "utf-8"));
      settings = parsed.settings;
    } catch {
      settings = void 0;
    }
    this.#settingsCache = resolveSettings({ ...EMPTY_STATE2, settings: settings ?? {} });
    return this.#settingsCache;
  }
  /**
   * Persist a settings patch and refresh the cache.
   *
   * @param patch - Fields to change; absent fields keep their stored value.
   * @returns The settings after the change.
   */
  async saveSettings(patch) {
    let next = this.#settingsNow();
    const before = next.requireConfirmation;
    await this.#store.update((state) => {
      state.settings = { ...state.settings ?? {}, ...patch };
      next = resolveSettings(state);
    });
    this.#settingsCache = next;
    if (next.requireConfirmation !== before) this.refreshSessionTool();
    return next;
  }
  /** Route one inbound WeChat message. */
  async #handleInbound(message) {
    if (message.contextToken !== void 0) {
      const token = message.contextToken;
      await this.#store.update((state) => {
        const perAccount = state.contextTokens[message.accountId] ??= {};
        perAccount[message.conversationId] = token;
      });
    }
    await this.#flushPending(message.conversationId);
    const account = await this.#account(message.accountId);
    if (account === void 0) return;
    this.#startTyping(message.accountId, message.conversationId, message.peerId);
    let handedOff = false;
    try {
      for (const item of message.media ?? []) {
        this.#recordBoot(`inbound media item: ${JSON.stringify(item)}`);
      }
      for (const item of message.raw.item_list ?? []) {
        if (item.ref_msg === void 0) continue;
        this.#recordBoot(`inbound quote: ${JSON.stringify(item.ref_msg)}`);
      }
      const attachments = await this.#fetchAttachments(message);
      const settings = await this.#settings();
      if (attachments.length === 0 && await this.#settleInteraction(message)) return;
      if (attachments.length > 0) {
        this.#parkAttachments(message, attachments, settings);
        return;
      }
      handedOff = await this.#deliver(message, { media: [], text: message.text, attachments: [] });
    } catch (error) {
      this.#recordError(`\u5904\u7406\u6D88\u606F\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
      await this.#reply(account, message.conversationId, message.peerId, "\u5904\u7406\u8FD9\u6761\u6D88\u606F\u65F6\u51FA\u9519\u4E86\u3002");
    } finally {
      if (!handedOff) this.#stopTyping(message.conversationId);
    }
  }
  /**
   * Show "typing…" for a conversation, and keep it showing until the reply goes out.
   *
   * Re-sent on an interval because the indicator is short-lived on the client: sent once, it
   * disappears long before a real task finishes, which is the case this exists for. The interval is
   * cleared in {@link #stopTyping}, and bounded here so a reply that never comes cannot leave the
   * channel re-sending forever.
   *
   * @param accountId - Account the message came in on.
   * @param conversationId - Conversation to key the state by.
   * @param peerId - Peer to show it to.
   */
  #startTyping(accountId, conversationId, peerId) {
    const monitor = this.#monitors.get(accountId)?.monitor;
    if (monitor === void 0) return;
    if (this.#typing.has(conversationId)) return;
    const send = () => {
      void monitor.setTyping(peerId, true);
    };
    send();
    const interval = setInterval(send, TYPING_REFRESH_MS);
    interval.unref?.();
    const cap = setTimeout(() => {
      this.#stopTyping(conversationId);
    }, TYPING_MAX_MS);
    cap.unref?.();
    this.#typing.set(conversationId, { interval, cap, accountId, peerId });
  }
  /**
   * Clear "typing…" for a conversation, if it was showing.
   *
   * @param conversationId - Conversation to clear.
   */
  #stopTyping(conversationId) {
    const state = this.#typing.get(conversationId);
    if (state === void 0) return;
    this.#typing.delete(conversationId);
    clearInterval(state.interval);
    clearTimeout(state.cap);
    const monitor = this.#monitors.get(state.accountId)?.monitor;
    void monitor?.setTyping(state.peerId, false);
  }
  /**
   * Park one non-text message and (re)start its window.
   *
   * Nothing is sent yet. Whatever was already parked stays, so a video followed by a photo
   * followed by a file is one batch, not three.
   */
  #parkAttachments(message, attachments, settings) {
    const existing = this.#pending.get(message.conversationId);
    if (existing !== void 0) clearTimeout(existing.timer);
    const text = [existing?.text ?? "", message.text].map((part) => part.trim()).filter((part) => part !== "").join("\n\n");
    const timer = settings.autoReplyAttachments ? setTimeout(() => {
      void this.#deliver(message, { media: [], text: "", attachments: [] });
    }, settings.mergeWindowMs) : void 0;
    timer?.unref?.();
    this.#pending.set(message.conversationId, {
      attachments: [...existing?.attachments ?? [], ...attachments],
      text,
      timer
    });
  }
  /**
   * Settle a pending interaction from the user's reply, when one is waiting.
   *
   * @param message - The inbound message.
   * @returns Whether the reply was consumed as an answer.
   */
  async #settleInteraction(message) {
    const pending = this.#interactions.get(message.conversationId);
    if (pending === void 0) return false;
    const value = pending.accept(message.text);
    if (value === void 0) {
      pending.reprompt();
      return false;
    }
    this.#interactions.delete(message.conversationId);
    this.#recordBoot(`interaction settled: ${pending.kind}`);
    pending.settle(value);
    return true;
  }
  /**
   * Ask the user a question over WeChat and wait for the answer.
   *
   * The account and peer are passed in rather than looked up from the conversation's binding. The
   * session-control tool runs inside a session that may have no binding yet — it can be asked to
   * create the first one — so requiring a lookup here would fail exactly when the feature is
   * needed.
   *
   * @param conversationId - Conversation to ask.
   * @param account - Account to reply from.
   * @param peerId - Recipient of the question.
   * @param body - Prompt text.
   * @param kind - Interaction kind, for logging.
   * @param parse - Reads the reply, returning undefined when it is not an answer.
   * @param signal - Aborts when the harness withdraws the request.
   * @returns The parsed answer, or undefined when the request was withdrawn first.
   */
  async #ask(conversationId, account, peerId, body, kind, parse, signal) {
    const settled = Promise.withResolvers();
    const previous = this.#interactions.get(conversationId);
    if (previous !== void 0) {
      this.#interactions.delete(conversationId);
      previous.settle(void 0);
    }
    this.#interactions.set(conversationId, {
      kind,
      accept: parse,
      settle: settled.resolve,
      reprompt: () => {
        void this.#reply(account, conversationId, peerId, `\u8BF7\u56DE\u590D\u4E0A\u4E00\u6761\u63D0\u793A\u3002

${body}`);
      }
    });
    const onAbort = () => {
      this.#interactions.delete(conversationId);
      settled.resolve(void 0);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await this.#reply(account, conversationId, peerId, body);
      this.#recordBoot(`interaction asked: ${kind} -> ${peerId}`);
      return await settled.promise;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      const current = this.#interactions.get(conversationId);
      if (current?.settle === settled.resolve) {
        this.#interactions.delete(conversationId);
      }
    }
  }
  /**
   * Claim permission prompts for conversations bound to WeChat.
   *
   * Unbound conversations delegate, so the desktop pane answers as before.
   *
   * @returns The listener for `ctx.on('approval/request', ...)`.
   */
  approvalListener() {
    return async (request, next) => {
      const record = request ?? {};
      const sessionId = sessionIdOf(record.agent);
      const conversationId = await this.#conversationForAgentSession(sessionId);
      this.#recordBoot(
        `approval seen: tool=${String(record.toolName)} session=${sessionId ?? "(none)"} ${conversationId === void 0 ? "not-a-wechat-session -> delegate" : "claiming"}`
      );
      if (conversationId === void 0) return await next();
      const target = await this.#askTarget(conversationId);
      if (target === void 0) return await next();
      const answer = await this.#ask(
        conversationId,
        target.account,
        target.peerId,
        presentApproval(record).body,
        "approval",
        parseApprovalReply,
        record.signal
      );
      if (answer === void 0) return await next();
      return answer;
    };
  }
  /**
   * Claim structured questions for conversations bound to WeChat.
   *
   * @returns The listener for `ctx.on('user-questions/request', ...)`.
   */
  questionListener() {
    return async (request, next) => {
      const record = request ?? {};
      const questions = record.questions;
      if (!Array.isArray(questions) || questions.length === 0) return await next();
      const sessionId = sessionIdOf(record.agent);
      const conversationId = await this.#conversationForAgentSession(sessionId);
      this.#recordBoot(
        `question seen: count=${String(questions.length)} session=${sessionId ?? "(none)"} ${conversationId === void 0 ? "not-a-wechat-session -> delegate" : "claiming"}`
      );
      if (conversationId === void 0) return await next();
      const target = await this.#askTarget(conversationId);
      if (target === void 0) return await next();
      const answer = await this.#ask(
        conversationId,
        target.account,
        target.peerId,
        presentQuestions(questions).body,
        "question",
        (reply) => parseQuestionReply(questions, reply),
        record.signal
      );
      if (answer === void 0) return await next();
      return answer;
    };
  }
  /**
   * Resolve where a question for a conversation should be sent.
   *
   * Used by the listeners that are handed a session rather than a message, so they have to look the
   * conversation up. A confirmation does not need this: it is asked from the inbound message,
   * which already carries both.
   *
   * @param conversationId - Conversation to resolve.
   * @returns The account and peer, or undefined when the conversation is not bound.
   */
  async #askTarget(conversationId) {
    const state = await this.#store.read();
    const binding = state.bindings[conversationId];
    if (binding === void 0) return void 0;
    const account = state.accounts[binding.accountId];
    if (account === void 0) return void 0;
    return { account, peerId: binding.peerId };
  }
  /**
   * The conversation a session may speak for.
   *
   * Only the session a conversation is **currently** bound to may act on its behalf.
   *
   * This used to also accept any session a conversation had ever used, through a `sessionOwners`
   * map. That map is gone, and the reason is worth keeping: it made a conversation's *former*
   * session able to send messages, ask questions and switch sessions for the rest of time. After
   * `/new`, the development session this plugin was written in stayed an owner of the WeChat
   * conversation, so a question asked from it — through a different harness session entirely —
   * arrived on the user's phone.
   *
   * A bookkeeping trail is not a grant of authority, and the two were the same map.
   *
   * @param sessionId - Session to look up, if known.
   * @returns The conversation key, when this session is the one bound to it.
   */
  async #conversationForAgentSession(sessionId) {
    if (sessionId === void 0) return void 0;
    const state = await this.#store.read();
    const found = Object.values(state.bindings).find((entry) => entry.sessionId === sessionId);
    return found?.conversationId;
  }
  /**
   * Hand one turn to the agent.
   *
   * Any parked attachment is flushed into this call first, so an instruction that arrives
   * moments after a photo reaches the agent once, with both. Passing empty text yields the
   * same shape as waiting out the window — which is why releasing needs no separate path.
   */
  async #deliver(message, incoming) {
    try {
      const parked = this.#claimParked(message.conversationId);
      const attachments = [...parked.attachments, ...incoming.attachments];
      const quoted = await this.#resolveQuote(message);
      const text = [parked.text, incoming.text].map((part) => part.trim()).filter((part) => part !== "").join("\n\n");
      const account = await this.#account(message.accountId);
      if (account === void 0) return false;
      if (attachments.length === 0) {
        const routed = await this.#router.route({
          conversationId: message.conversationId,
          accountId: message.accountId,
          peerId: message.peerId,
          text
        });
        if (routed.kind === "reply") {
          await this.#reply(account, message.conversationId, message.peerId, routed.text);
          return false;
        }
        await this.#prompt(routed.decision, message, [], quoted);
        return true;
      }
      const bound = await this.#router.route({
        conversationId: message.conversationId,
        accountId: message.accountId,
        peerId: message.peerId,
        text: ""
      });
      if (bound.kind === "reply") {
        await this.#reply(account, message.conversationId, message.peerId, bound.text);
        return false;
      }
      await this.#prompt({ ...bound.decision, prompt: text }, message, attachments, quoted);
      return true;
    } catch (error) {
      this.#recordError(`\u5904\u7406\u6D88\u606F\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
      const account = await this.#account(message.accountId);
      if (account !== void 0) {
        await this.#reply(account, message.conversationId, message.peerId, "\u5904\u7406\u8FD9\u6761\u6D88\u606F\u65F6\u51FA\u9519\u4E86\u3002");
      }
      return false;
    }
  }
  /**
   * Claim and clear whatever is parked for a conversation.
   *
   * @param conversationId - Conversation to collect for.
   * @returns The parked attachments and their accumulated caption.
   */
  #claimParked(conversationId) {
    const parked = this.#pending.get(conversationId);
    if (parked === void 0) return { attachments: [], text: "" };
    clearTimeout(parked.timer);
    this.#pending.delete(conversationId);
    return { attachments: parked.attachments, text: parked.text };
  }
  /** Drop every parked batch. Called on teardown so no timer outlives the plugin. */
  #clearParked() {
    for (const parked of this.#pending.values()) clearTimeout(parked.timer);
    this.#pending.clear();
  }
  /**
   * Register the tool the agent uses to send a file back to WeChat.
   *
   * This is what makes outbound media reachable at all. The client could already upload
   * and send an image — the functions existed — but nothing ever called them, so a file
   * the agent produced had no way out of the process and the phone saw nothing.
   *
   * @returns The disposer that unregisters the tool.
   */
  registerTools() {
    const tools = this.#ctx.tools;
    if (tools === void 0) {
      this.#recordError("\u6B64\u7EC4\u5408\u6CA1\u6709\u5DE5\u5177\u670D\u52A1\uFF0Cagent \u65E0\u6CD5\u4E3B\u52A8\u53D1\u9001\u6587\u4EF6\u5230\u5FAE\u4FE1");
      return () => {
      };
    }
    const send = tools.register({
      name: "send_to_wechat",
      description: "Send a file from this machine to the WeChat conversation that asked for it. Images arrive as photos, videos as playable clips, and everything else as a file attachment, chosen from the path extension. Use this whenever the user asked to see, receive, or be sent a file, image, screenshot, chart, or video. The path must be absolute and may point anywhere on this machine \u2014 a file on the Desktop or in a project folder is sent as it is, with no need to copy it anywhere first.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of the file to send."
          },
          caption: {
            type: "string",
            description: "Optional short message to send before the file."
          }
        },
        required: ["path"],
        additionalProperties: false
      },
      output: {
        // Standard JSON Schema: `required` is a sibling array of property names. The
        // `defineTool` parameter-spec form puts `required: true` inside the property
        // itself, and the registry rejects that shape with a JsonSchemaError.
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { detail: { type: "string" } },
          required: ["detail"]
        },
        render: (args) => [
          { type: "text", text: `sent ${String(args.path ?? "")} to WeChat` }
        ]
      },
      execute: async (args, exec) => ({
        detail: await this.#sendFileToWechat(String(args.path ?? ""), args.caption, exec)
      })
    });
    const control = tools.register(this.#sessionToolDefinition());
    const notify = tools.register({
      name: "notify_wechat",
      description: `Push a message, and optionally a file, to the user's WeChat. Unlike send_to_wechat this works from any session, including one the WeChat conversation is not currently bound to, which is what makes "tell me when it is done" possible. Always reaches the conversation the user is currently in; there is no way to choose another. Use it to report a finished task, or to send a file the user asked to receive. Keep text short \u2014 it is read on a phone.`,
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The message to send. Short, and written for a phone."
          },
          path: {
            type: "string",
            description: "Optional absolute path of a file to send after the text. Images arrive as photos, videos as playable clips, everything else as a file attachment."
          }
        },
        required: ["text"],
        additionalProperties: false
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { detail: { type: "string" } },
          required: ["detail"]
        },
        render: (args) => [
          { type: "text", text: `notify WeChat${args.path === void 0 ? "" : ` with ${String(args.path)}`}` }
        ]
      },
      execute: async (args, exec) => ({
        detail: await this.#notifyWechat(String(args.text ?? ""), args.path, exec)
      })
    });
    return () => {
      this.#sessionToolDisposer = void 0;
      send();
      control();
      notify();
    };
  }
  /**
   * Deliver a message, and optionally a file, to the bound WeChat conversation.
   *
   * @param text - Message to send. Sent first, so a file arrives with its explanation already there.
   * @param path - Optional absolute path of a file to send after the text.
   * @param exec - Tool execution context, used for cancellation and for the fallback check.
   * @returns A short human-readable outcome.
   */
  async #notifyWechat(text, path, exec) {
    if (text.trim() === "" && typeof path !== "string") {
      throw new Error("\u81F3\u5C11\u8981\u7ED9 text \u6216 path \u5176\u4E2D\u4E00\u4E2A\u3002");
    }
    if (!this.#settingsFromDisk().allowCrossSessionNotify) {
      const own = await this.#conversationForAgent(exec.agent);
      if (own === void 0) {
        throw new Error(
          "\u8FD9\u4E2A\u4F1A\u8BDD\u6CA1\u6709\u7ED1\u5B9A\u5FAE\u4FE1\u5BF9\u8BDD\uFF0C\u800C\u300C\u5141\u8BB8\u5176\u4ED6\u4F1A\u8BDD\u63A8\u9001\u5230\u5FAE\u4FE1\u300D\u662F\u5173\u95ED\u7684\u3002\u8BF7\u8BA9\u7528\u6237\u5728\u8BBE\u7F6E\u91CC\u6253\u5F00\u5B83\uFF0C\u6216\u5148\u5728\u5FAE\u4FE1\u91CC\u53D1\u4E00\u6761\u6D88\u606F\u3002"
        );
      }
      return await this.#deliverTo(own, text, path, exec.signal);
    }
    const bound = await this.#boundConversation();
    if (!bound.ok) throw new Error(bound.reason);
    return await this.#deliverTo(bound.target, text, path, exec.signal);
  }
  /**
   * Send the text and then the file, into one already-resolved conversation.
   *
   * Each piece is attempted separately and a refusal queues only the piece that was refused, so a
   * message that arrives before the window closes is not sent twice when the file behind it is held
   * back for later.
   *
   * @param target - Conversation to deliver to.
   * @param text - Message to send; skipped when empty.
   * @param path - File to send; skipped unless it is a string.
   * @param signal - Cancellation from the caller, when there is one.
   * @returns What was sent, for the agent to report.
   */
  async #deliverTo(target, text, path, signal) {
    const file = typeof path === "string" && path !== "" ? path : void 0;
    if (text.trim() === "" && file === void 0) throw new Error("\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u5185\u5BB9\u3002");
    let outstandingText = text.trim() === "" ? "" : text;
    let outstandingPath = file;
    const done = [];
    if (outstandingText !== "") {
      if (await this.#sendOrQueue(target, outstandingText, void 0, signal)) {
        done.push("\u6D88\u606F");
        outstandingText = "";
      }
    }
    if (outstandingPath !== void 0) {
      if (await this.#sendOrQueue(target, "", outstandingPath, signal)) {
        done.push(`\u6587\u4EF6 ${basename(outstandingPath)}`);
        outstandingPath = void 0;
      }
    }
    if (outstandingText === "" && outstandingPath === void 0) {
      const summary = `\u5DF2\u901A\u8FC7\u5FAE\u4FE1\u53D1\u9001\uFF1A${done.join("\u3001")}`;
      this.#recordBoot(`notify_wechat: ${done.join(", ")} to ${target.conversationId}`);
      return summary;
    }
    const held = outstandingPath === void 0 ? "\u8FD9\u6761\u6D88\u606F" : `\u6587\u4EF6 ${basename(outstandingPath)}`;
    this.#recordBoot(
      `notify_wechat: \u7A97\u53E3\u5DF2\u5173\u95ED\uFF0C${held} \u5DF2\u6392\u961F\uFF08\u4F1A\u8BDD ${target.conversationId}\uFF09` + (done.length > 0 ? `\uFF1B\u5DF2\u5148\u9001\u51FA ${done.join("\u3001")}` : "")
    );
    return `${held}\u6CA1\u80FD\u7ACB\u523B\u53D1\u51FA\uFF1A\u5FAE\u4FE1\u7684\u56DE\u4FE1\u7A97\u53E3\u5DF2\u5173\u95ED\u3002\u5DF2\u6392\u961F\uFF0C\u4F1A\u5728\u7528\u6237\u4E0B\u6B21\u5728\u5FAE\u4FE1\u91CC\u53D1\u6D88\u606F\u65F6\u81EA\u52A8\u8865\u53D1\u3002` + (done.length > 0 ? `\uFF08\u5DF2\u5148\u9001\u51FA\uFF1A${done.join("\u3001")}\uFF09` : "");
  }
  /**
   * Send one piece, or keep it for the next open window.
   *
   * Only a refusal by the service is treated this way. A missing file, a network failure or a
   * cancelled run all throw as before: those will fail again the same way, and turning them into a
   * backlog would only hide the error behind a delay.
   *
   * @param target - Conversation to deliver to.
   * @param text - Text to send; empty when only a file is being sent.
   * @param path - File to send; undefined when only text is being sent.
   * @param signal - Cancellation from the caller, when there is one.
   * @returns True when it was sent now, false when it was queued.
   */
  async #sendOrQueue(target, text, path, signal) {
    try {
      if (path !== void 0) await this.#conveyFile(path, void 0, target, signal);
      else {
        await this.#sendText(
          target.account,
          target.conversationId,
          target.peerId,
          text,
          target.contextToken
        );
      }
      return true;
    } catch (error) {
      if (!(error instanceof SendRefusedError)) throw error;
      await this.#store.update((state) => {
        const dropped = queuePendingNotification(state, {
          conversationId: target.conversationId,
          text,
          ...path === void 0 ? {} : { path }
        });
        if (dropped > 0) {
          this.#recordBoot(`notify_wechat: \u961F\u5217\u5DF2\u6EE1\uFF0C\u4E22\u5F03\u4E86 ${String(dropped)} \u6761\u6700\u65E7\u7684\u5F85\u53D1\u6D88\u606F`);
        }
      });
      return false;
    }
  }
  /**
   * Deliver anything queued for this conversation, now that its window is open again.
   *
   * Called as soon as an inbound message refreshes the reply token, and before that message is
   * handled: the user's own turn is what reopens the window, so the backlog belongs in front of the
   * answer rather than after it — otherwise the notifications they were waiting for appear below a
   * reply that has nothing to do with them.
   *
   * A piece that is refused again stays queued for the next attempt; one whose file has since been
   * deleted is dropped, because retrying it forever would block everything behind it.
   *
   * @param conversationId - Conversation whose window just opened.
   */
  async #flushPending(conversationId) {
    try {
      const expired = await this.#expirePending();
      if (expired > 0) {
        this.#recordBoot(`pending: \u4E22\u5F03 ${String(expired)} \u6761\u8FC7\u671F\u7684\u5F85\u53D1\u6D88\u606F`);
      }
      const pending = (await this.#store.read()).pendingNotifications ?? [];
      const mine = pending.filter((entry) => entry.conversationId === conversationId);
      if (mine.length === 0) return;
      const bound = await this.#boundConversation();
      if (!bound.ok) return;
      const target = bound.target;
      if (target.conversationId !== conversationId) return;
      let sent = 0;
      const unsendable = [];
      for (const entry of mine) {
        try {
          if (entry.text.trim() !== "") {
            await this.#sendText(
              target.account,
              target.conversationId,
              target.peerId,
              entry.text,
              target.contextToken
            );
          }
          if (entry.path !== void 0) {
            if (!existsSync2(entry.path)) {
              unsendable.push(basename(entry.path));
              await this.#dropPending(entry.id);
              continue;
            }
            await this.#conveyFile(entry.path, void 0, target);
          }
          sent += 1;
          await this.#dropPending(entry.id);
        } catch (error) {
          if (!(error instanceof SendRefusedError)) {
            this.#recordError(
              `\u8865\u53D1\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
            );
            await this.#dropPending(entry.id);
          }
        }
      }
      if (sent > 0 || unsendable.length > 0) {
        this.#recordBoot(
          `pending: \u8865\u53D1 ${String(sent)} \u6761\u5230 ${conversationId}` + (unsendable.length > 0 ? `\uFF1B${String(unsendable.length)} \u4E2A\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728` : "")
        );
      }
      if (unsendable.length > 0) {
        await this.#notifyAboutMissingFiles(conversationId, unsendable);
      }
    } catch (error) {
      this.#recordError(
        `\u8865\u53D1\u5F85\u53D1\u6D88\u606F\u65F6\u51FA\u9519\uFF1A${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Drop everything past the age bound.
   *
   * @returns How many entries were dropped.
   */
  async #expirePending() {
    let dropped = 0;
    await this.#store.update((state) => {
      dropped = expirePendingNotifications(state).length;
    });
    return dropped;
  }
  /**
   * Remove one delivered entry.
   *
   * By id rather than by position: the flush loop reads the queue once, and a concurrent enqueue
   * would shift every index under it.
   *
   * @param id - Identity of the entry to remove.
   */
  async #dropPending(id) {
    await this.#store.update((state) => {
      const queue = state.pendingNotifications;
      if (queue === void 0) return;
      const next = queue.filter((entry) => entry.id !== id);
      if (next.length === 0) delete state.pendingNotifications;
      else state.pendingNotifications = next;
    });
  }
  /**
   * Tell the user which queued files could no longer be found.
   *
   * Sent rather than only logged: they were promised a file, and its absence is the one part of a
   * late delivery they cannot infer from what does arrive.
   *
   * @param conversationId - Conversation to tell.
   * @param names - File names that no longer exist.
   */
  async #notifyAboutMissingFiles(conversationId, names) {
    try {
      const bound = await this.#boundConversation();
      if (!bound.ok || bound.target.conversationId !== conversationId) return;
      await this.#sendText(
        bound.target.account,
        bound.target.conversationId,
        bound.target.peerId,
        `\u4E4B\u524D\u6709 ${String(names.length)} \u4E2A\u6392\u961F\u53D1\u9001\u7684\u6587\u4EF6\u5DF2\u7ECF\u627E\u4E0D\u5230\u4E86\uFF1A${names.join("\u3001")}`,
        bound.target.contextToken
      );
    } catch {
    }
  }
  /**
   * Re-register the session tool so its description reflects the current setting.
   *
   * Called after the confirmation preference changes. Without it the setting would appear to do
   * nothing until the next restart, because the agent reads the description, not the setting.
   */
  refreshSessionTool() {
    const tools = this.#ctx.tools;
    if (tools === void 0) return;
    this.#sessionToolDisposer?.();
    this.#sessionToolDisposer = tools.register(this.#sessionToolDefinition());
  }
  /**
   * The session tool as the registry needs it.
   *
   * Built synchronously, because `apply` registers tools during setup and cannot await. The
   * settings are read straight from disk here rather than through the cache, which is filled on
   * first use for the assistant-stream path — reading it at registration would see the built-in
   * defaults and the confirmation setting would silently do nothing.
   *
   * @returns The definition to register.
   */
  #sessionToolDefinition() {
    const requireConfirmation = this.#settingsFromDisk().requireConfirmation;
    return {
      name: "session_control",
      description: sessionToolDescription(requireConfirmation),
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "switch", "new", "current", "cancel"],
            description: "list: show every conversation with its number. switch: move this WeChat conversation to an existing one. new: start a fresh one. current: report which one is in use. cancel: interrupt the work running in it."
          },
          target: {
            type: "string",
            description: `For switch, the conversation to move to: its number from list, or its title. For new, an optional title. For list, the literal "all" shows conversations from every workspace, not just this channel's own.`
          }
        },
        required: ["action"],
        additionalProperties: false
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            detail: { type: "string" },
            ok: { type: "boolean" },
            otherWorkspaces: { type: "number" }
          },
          required: ["detail", "ok"]
        },
        render: (args) => [
          { type: "text", text: `session_control ${String(args.action ?? "")}` }
        ]
      },
      execute: async (args, exec) => {
        const result = await this.controlSession(
          sessionIdOf(exec.agent),
          String(args.action ?? ""),
          args.target === void 0 ? void 0 : String(args.target)
        );
        this.#recordBoot(
          `session_control: action=${String(args.action)} target=${String(args.target ?? "")} ok=${String(result.ok)}`
        );
        const rows = renderTable(result.sessions, result.sessions.find((row) => row.current)?.sessionId);
        return {
          detail: rows === "" ? result.detail : `${result.detail}

${rows}`,
          ok: result.ok,
          otherWorkspaces: result.otherWorkspaces
        };
      }
    };
  }
  /**
   * Upload one local file and deliver it to the conversation bound to the calling agent.
   *
   * @param path - Absolute path of the file to send.
   * @param caption - Optional text sent ahead of the file.
   * @param exec - Tool execution context, used for the calling agent and cancellation.
   * @returns A short human-readable outcome.
   */
  async #sendFileToWechat(path, caption, exec) {
    const target = await this.#conversationForAgent(exec.agent);
    if (target === void 0) {
      throw new Error(
        "\u8FD9\u4E2A\u4F1A\u8BDD\u6CA1\u6709\u7ED1\u5B9A\u4EFB\u4F55\u5FAE\u4FE1\u5BF9\u8BDD\uFF0C\u65E0\u6CD5\u53D1\u9001\u3002\u8BF7\u8BA9\u7528\u6237\u5728\u5FAE\u4FE1\u91CC\u5148\u53D1\u4E00\u6761\u6D88\u606F\u3002"
      );
    }
    return await this.#conveyFile(path, caption, target, exec.signal);
  }
  /**
   * Upload and send one file into a conversation.
   *
   * Split from {@link #sendFileToWechat} so the channel can send on its own behalf — a reply too
   * long for a message — without pretending to be a tool invocation with an agent to resolve.
   *
   * @param path - File to read and send.
   * @param caption - Optional text sent before the file.
   * @param target - Resolved conversation.
   * @param signal - Cancellation from the caller, when there is one.
   */
  async #conveyFile(path, caption, target, signal) {
    const data = await readFile3(path);
    const fileName = basename(path);
    const kind = mediaKindOf(fileName);
    const uploaded = await uploadMedia({
      account: target.account,
      toUserId: target.peerId,
      data,
      fileName,
      mediaType: MEDIA_TYPE_BY_KIND[kind],
      ...signal === void 0 ? {} : { signal },
      onDiagnostic: (detail) => {
        this.#recordBoot(
          `outbound upload: target=${detail.uploadUrl.slice(0, 150)}
  response=${JSON.stringify(detail.response).slice(0, 800)}`
        );
      }
    });
    if (typeof caption === "string" && caption.trim() !== "") {
      await this.#reply(target.account, target.conversationId, target.peerId, caption.trim());
    }
    const sender = SENDER_BY_KIND[kind];
    const sent = await sender({
      account: target.account,
      to: target.peerId,
      uploaded,
      ...target.contextToken === void 0 ? {} : { contextToken: target.contextToken },
      ...signal === void 0 ? {} : { signal }
    });
    this.#recordBoot(
      `outbound: ${fileName} ${data.length}B -> ${target.peerId} (${MEDIA_LABEL_BY_KIND[kind]}) id=${sent.serverMessageId ?? "(none)"}`
    );
    if (sent.serverMessageId !== void 0) {
      const id = sent.serverMessageId;
      await this.#store.update((s) => {
        const { quoteHistory } = resolveSettings(s);
        rememberSentMessage(
          s,
          target.account.accountId,
          target.conversationId,
          { messageId: id, kind, preview: fileName, at: Date.now() },
          quoteHistory
        );
      });
    }
    return `\u5DF2\u53D1\u9001 ${fileName}\uFF08${data.length} \u5B57\u8282\uFF09\u5230\u5FAE\u4FE1`;
  }
  /**
   * Find the WeChat conversation whose session is the calling agent's.
   *
   * @param agent - The tool's calling agent, whose session id identifies the binding.
   */
  async #conversationForAgent(agent) {
    const sessionId = sessionIdOf(agent);
    if (sessionId === void 0) return void 0;
    const state = await this.#store.read();
    const binding = Object.values(state.bindings).find((entry) => entry.sessionId === sessionId);
    return this.#conversationOf(state, binding);
  }
  /**
   * The conversation the channel is currently bound to, whoever is asking.
   *
   * This is what lets a session that is *not* the bound one deliver a message — the point of
   * `notify_wechat`. The target is read from the binding rather than taken from the caller, so a
   * proactive message can only ever reach the conversation the user is actually in; there is no
   * argument an agent could get wrong and send somewhere else.
   *
   * Refuses when several conversations are bound rather than guessing: sending a file to the wrong
   * person is not a failure worth risking to save an error message. Today the channel binds one, so
   * this is a guard against a future that adds accounts.
   *
   * @returns The bound conversation, or a reason it cannot be resolved.
   */
  async #boundConversation() {
    const state = await this.#store.read();
    const bindings = Object.values(state.bindings);
    if (bindings.length === 0) {
      return { ok: false, reason: "\u8FD8\u6CA1\u6709\u5FAE\u4FE1\u5BF9\u8BDD\u3002\u8BF7\u5148\u5728\u5FAE\u4FE1\u91CC\u7ED9\u673A\u5668\u4EBA\u53D1\u4E00\u6761\u6D88\u606F\uFF0C\u4E4B\u540E\u624D\u80FD\u4E3B\u52A8\u63A8\u9001\u3002" };
    }
    if (bindings.length > 1) {
      return {
        ok: false,
        reason: `\u5F53\u524D\u7ED1\u5B9A\u4E86 ${String(bindings.length)} \u4E2A\u5FAE\u4FE1\u5BF9\u8BDD\uFF0C\u65E0\u6CD5\u786E\u5B9A\u53D1\u7ED9\u54EA\u4E00\u4E2A\u3002\u8BF7\u5148\u89E3\u7ED1\u591A\u4F59\u7684\u3002`
      };
    }
    const target = this.#conversationOf(state, bindings[0]);
    if (target === void 0) {
      return { ok: false, reason: "\u7ED1\u5B9A\u7684\u5FAE\u4FE1\u8D26\u53F7\u5DF2\u7ECF\u4E0D\u5728\u72B6\u6001\u91CC\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801\u7ED1\u5B9A\u3002" };
    }
    return { ok: true, target };
  }
  /**
   * Turn one stored binding into everything a send needs.
   *
   * Shared by the agent-scoped and conversation-scoped lookups so the two cannot drift: the rules
   * about which account and which reply token apply are the same either way.
   *
   * @param state - State the binding came from.
   * @param binding - Stored binding, or undefined when there was none.
   * @returns The conversation, or undefined when the account is gone.
   */
  #conversationOf(state, binding) {
    if (binding === void 0) return void 0;
    const account = state.accounts[binding.accountId];
    if (account === void 0) return void 0;
    const contextToken = state.contextTokens[binding.accountId]?.[binding.conversationId];
    return {
      account,
      peerId: binding.peerId,
      conversationId: binding.conversationId,
      ...contextToken === void 0 ? {} : { contextToken }
    };
  }
  /**
   * Whether this is the first message a session will ever receive.
   *
   * Asked of the store rather than tracked in memory: the answer has to survive a restart, and a
   * session the user created on the desktop and switched to is not new either.
   *
   * @param sessionId - Session about to be prompted.
   * @returns True when nothing has been recorded for it yet.
   */
  async #isFirstMessage(sessionId) {
    try {
      return await storedSessionWorkspace(this.#home, sessionId) === void 0;
    } catch {
      return false;
    }
  }
  /**
   * Download every attachment on a message and write it inside the session workspace.
   *
   * A failure here is recorded and skipped rather than thrown: a photo the service
   * will not serve should not cost the user the text that came with it.
   *
   * @param message - Inbound envelope, whose `media` is absent for text-only messages.
   * @returns One `{ media, path }` per attachment that downloaded successfully.
   */
  async #fetchAttachments(message) {
    const items = message.media ?? [];
    if (items.length === 0) return [];
    const stored = [];
    for (const item of items) {
      try {
        const media = await downloadItemMedia({ item });
        if (media === void 0) continue;
        const path = storeMedia(this.#home, media);
        stored.push({ media, path });
        this.#recordBoot(`media: ${media.kind} ${media.data.length}B -> ${path}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.#recordError(`\u9644\u4EF6\u4E0B\u8F7D\u5931\u8D25: ${detail}`);
        this.#recordBoot(`media: download failed, item=${JSON.stringify(item).slice(0, 600)}`);
      }
    }
    return stored;
  }
  /** Hand a prompt to its session. */
  async #prompt(decision, message, attachments = [], quoted) {
    const settings = await this.#settings();
    const naming = await this.#isFirstMessage(decision.sessionId);
    const lines = [
      decision.prompt,
      ...quoted === void 0 ? [] : [quoted],
      ...attachments.map((entry) => describeMedia(entry.media, entry.path)),
      // Held back only for the message that names the session; see below.
      ...naming || settings.presenceNote === "" ? [] : [settings.presenceNote]
    ].filter((line) => line !== "");
    const prompt = lines.join("\n\n");
    const outbound = naming && settings.presenceNote !== "" ? [prompt, settings.presenceNote].filter((text) => text !== "") : [prompt].filter((text) => text !== "");
    let delivered = false;
    for (const text of outbound) {
      if (await this.#submit(decision.sessionId, text, "steer")) delivered = true;
      else if (await this.#submit(decision.sessionId, text, "queue")) delivered = true;
    }
    if (delivered) return;
    this.#recordError("\u63D0\u4EA4\u4EFB\u52A1\u5931\u8D25: \u63D2\u8BDD\u4E0E\u6392\u961F\u90FD\u672A\u6210\u529F");
    const account = await this.#account(message.accountId);
    if (account === void 0) return;
    await this.#reply(
      account,
      message.conversationId,
      message.peerId,
      `\u6CA1\u80FD\u628A\u6D88\u606F\u4EA4\u7ED9\u4F1A\u8BDD\uFF0C\u8BF7\u91CD\u53D1\u4E00\u6B21\u3002

\u4F60\u7684\u5185\u5BB9\uFF1A
${truncate(prompt, MAX_REPLY_CHARS)}`
    );
  }
  /**
   * Submit a prompt, interrupting a running turn and falling back to the queue.
   *
   * A refused steer must not cost the message: the user's words are the one thing here that
   * cannot be reconstructed, while a queued answer is merely later than a steered one. So a
   * refusal becomes a plain queue submission rather than an error.
   *
   * @param sessionId - Session to prompt.
   * @param prompt - Text to submit.
   * @param mode - Placement to request while a turn is running.
   * @returns Whether the prompt was accepted; false leaves the caller to report the loss.
   */
  async #submit(sessionId, prompt, mode) {
    const request = {
      // A media-only message has no text of its own; the attachment line is then the entire
      // prompt, which is what `hasPromptContent` requires.
      content: [{ type: "text", text: prompt }]
    };
    try {
      await this.#ctx.sessionController.prompt(
        { ...request, requestId: `wechat-${randomUUID5()}`, sessionId, mode },
        new AbortController().signal
      );
      return true;
    } catch (error) {
      if (mode !== "steer") {
        this.#recordError(`\u63D0\u4EA4\u4EFB\u52A1\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
      this.#recordBoot(
        `steer refused, falling back to queue: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    try {
      await this.#ctx.sessionController.prompt(
        { ...request, requestId: `wechat-${randomUUID5()}`, sessionId, mode: "queue" },
        new AbortController().signal
      );
      return true;
    } catch (error) {
      this.#recordError(`\u6392\u961F\u63D0\u4EA4\u4E5F\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  /** Send one reply into a conversation. */
  /**
   * Submit a prompt, falling back to the queue when steering is refused.
   *
   * A refused steer must not lose the message: the user's words are the one thing here that
   * cannot be reconstructed. Steering is refused when the turn it targeted has already ended,
   * so the fallback is a plain queue and the message is answered on the next turn instead.
   *
   * @param sessionId - Session to prompt.
   * @param prompt - Text to submit.
   * @param mode - Preferred placement when a turn is running.
   */
  /** Send one reply into a conversation. */
  async #reply(account, conversationId, peerId, text) {
    this.#stopTyping(conversationId);
    const state = await this.#store.read();
    const contextToken = state.contextTokens[account.accountId]?.[conversationId];
    const settings = await this.#settings();
    try {
      await this.#sendWithinLimit(
        account,
        conversationId,
        peerId,
        text,
        settings,
        contextToken
      );
    } catch (error) {
      this.#recordError(`\u53D1\u9001\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * Send one message, splitting or filing it when it is longer than the configured limit.
   *
   * A reply over the limit is sent as a Markdown file rather than cut short. Truncation loses
   * the end of an answer silently, which for a long explanation or a code listing is the part
   * that mattered; a file always arrives whole and opens where the user can read it.
   *
   * @param account - Sending bot.
   * @param conversationId - Conversation, for the reply token.
   * @param peerId - Recipient.
   * @param text - Full reply text.
   * @param settings - Resolved settings, so one message sees one consistent limit.
   * @param contextToken - Reply token, when one is stored.
   */
  async #sendWithinLimit(account, conversationId, peerId, text, settings, contextToken) {
    const limit = settings.maxReplyChars;
    if (limit <= 0 || text.length <= limit) {
      await this.#sendText(account, conversationId, peerId, truncate(text, Math.max(limit, 1)), contextToken);
      return;
    }
    await this.#sendText(
      account,
      conversationId,
      peerId,
      `\u56DE\u590D\u8F83\u957F\uFF08${String(text.length)} \u5B57\uFF09\uFF0C\u5DF2\u4F5C\u4E3A\u6587\u4EF6\u53D1\u9001\u3002`,
      contextToken
    );
    const name2 = `\u56DE\u590D-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.md`;
    const path = join4(this.#mediaDir(), name2);
    await writeFile2(path, text, "utf8");
    await this.#conveyFile(path, void 0, {
      account,
      conversationId,
      peerId,
      ...contextToken === void 0 ? {} : { contextToken }
    });
    this.#recordBoot(`long reply ${String(text.length)} chars -> ${name2}`);
  }
  /**
   * The folder generated replies and inbound attachments are written to, created if absent.
   *
   * Created on demand rather than when the first attachment arrives: a long reply can be the
   * first thing this channel ever writes, and a missing folder would surface as a silently
   * truncated answer instead of a file.
   */
  #mediaDir() {
    const dir = join4(this.#home, WORKSPACE_DIR_NAME, MEDIA_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  /**
   * Send one text message and record the id the service assigns.
   *
   * @param account - Sending bot.
   * @param conversationId - Conversation, for the reply token and the quote cache.
   * @param peerId - Recipient.
   * @param text - Already-limited text.
   * @param contextToken - Reply token, when one is stored.
   */
  async #sendText(account, conversationId, peerId, text, contextToken) {
    const sent = await this.#send({
      account,
      to: peerId,
      text,
      ...contextToken === void 0 ? {} : { contextToken }
    });
    const id = sent?.serverMessageId;
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    this.#recordBoot(
      `outbound text id=${typeof id === "string" ? id : "(none)"} len=${String(text.length)} body=${preview}`
    );
    if (typeof id === "string") {
      const settings = await this.#settings();
      await this.#store.update((s) => {
        rememberSentMessage(
          s,
          account.accountId,
          conversationId,
          { messageId: id, kind: "text", preview, at: Date.now() },
          settings.quoteHistory
        );
      });
    }
  }
  /**
   * Resolve the WeChat conversation bound to a session.
   *
   * @param sessionId - Session to look up.
   */
  async #conversationForSession(sessionId) {
    const state = await this.#store.read();
    const binding = Object.values(state.bindings).find((entry) => entry.sessionId === sessionId);
    if (binding === void 0) return void 0;
    const account = state.accounts[binding.accountId];
    if (account === void 0) return void 0;
    const contextToken = state.contextTokens[binding.accountId]?.[binding.conversationId];
    return {
      account,
      conversationId: binding.conversationId,
      peerId: binding.peerId,
      ...contextToken === void 0 ? {} : { contextToken }
    };
  }
  /**
   * Record the field set of a tool-call frame that could not be used.
   *
   * Written once per distinct shape. This is the only way to tell "the harness names tool calls
   * somewhere other than `name`" apart from "cards are broken", which look identical from the
   * phone and from a passing test suite.
   */
  #recordToolShape(shape) {
    this.#recordOnce("#toolCallShapes", `tool-call frame fields (no call made): ${shape}`);
  }
  /**
   * Write a line to the boot log the first time a given value is seen.
   *
   * Keeps an observational log bounded: a chunk kind or frame shape repeats thousands of times
   * in one turn, and only its first occurrence carries information.
   *
   * @param bucket - Grouping key, so separate observations do not collide.
   * @param line - Line to write, once.
   */
  #recordOnce(bucket, line) {
    if (this.#seenShapes.get(bucket)?.has(line) === true) return;
    const seen = this.#seenShapes.get(bucket) ?? /* @__PURE__ */ new Set();
    seen.add(line);
    this.#seenShapes.set(bucket, seen);
    this.#recordBoot(line);
  }
  /**
   * Show that a tool call started, using the chat client's own tool card.
   *
   * Failure is recorded and swallowed: a card is decoration beside the reply, and losing one
   * must never cost the answer that follows it.
   */
  async #announceTool(sessionId, callId, toolName) {
    const key = `${sessionId}\0${callId}`;
    if (this.#announcedTools.has(key)) return;
    this.#announcedTools.add(key);
    this.#runningTools.set(key, { sessionId, toolName });
    try {
      const target = await this.#conversationForSession(sessionId);
      if (target === void 0) return;
      await sendToolCard({
        account: target.account,
        to: target.peerId,
        phase: "start",
        toolName,
        toolCallId: callId,
        runId: sessionId,
        ...target.contextToken === void 0 ? {} : { contextToken: target.contextToken }
      });
      this.#recordBoot(`tool card: start ${toolName} (${callId})`);
    } catch (error) {
      this.#recordError(`\u5DE5\u5177\u5361\u7247\u53D1\u9001\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * Build the `tools/result` listener that closes each tool card.
   *
   * Every running call is closed when a turn ends rather than only the ones the harness
   * reports: the result event is dispatched against the calling agent's scope, which this
   * host-scope plugin may not be inside, and a card left open would sit in the transcript
   * forever. The harness's own status is used when it arrives, so a failed call is not
   * reported as a success.
   *
   * @returns The listener to hand to `ctx.on('tools/result', ...)`.
   */
  toolResultListener() {
    return (exec, result) => {
      const record = exec ?? {};
      const toolName = typeof record.name === "string" ? record.name : void 0;
      const callId = typeof record.callId === "string" ? record.callId : void 0;
      const sessionId = sessionIdOf(record.agent);
      if (toolName === void 0 || callId === void 0 || sessionId === void 0) return;
      const key = `${sessionId}\0${callId}`;
      if (!this.#runningTools.has(key)) return;
      void this.#closeToolCard(key, result instanceof Error);
    };
  }
  /** Send the result card for one running tool call and forget it. */
  async #closeToolCard(key, failed) {
    const running = this.#runningTools.get(key);
    if (running === void 0) return;
    this.#runningTools.delete(key);
    const callId = key.slice(key.indexOf("\0") + 1);
    try {
      const target = await this.#conversationForSession(running.sessionId);
      if (target === void 0) return;
      await sendToolCard({
        account: target.account,
        to: target.peerId,
        phase: "end",
        toolName: running.toolName,
        toolCallId: callId,
        failed,
        runId: running.sessionId,
        ...target.contextToken === void 0 ? {} : { contextToken: target.contextToken }
      });
      this.#recordBoot(`tool card: end ${running.toolName} (${callId}) failed=${String(failed)}`);
    } catch (error) {
      this.#recordError(`\u5DE5\u5177\u5361\u7247\u53D1\u9001\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * Close every tool card still open for a session.
   *
   * Called when a turn ends, so a card cannot outlive the work it describes regardless of
   * whether the harness's result event reached this plugin.
   *
   * @param sessionId - Session whose turn just finished.
   */
  async closeOpenToolCards(sessionId) {
    const prefix = `${sessionId}\0`;
    const open = [...this.#runningTools.keys()].filter((key) => key.startsWith(prefix));
    for (const key of open) await this.#closeToolCard(key, false);
  }
  /**
   * Feed one assistant stream frame into the reply buffer.
   *
   * DSH emits deltas as the model generates. Batching them behind a short quiet
   * window turns a stream into one coherent WeChat message instead of a burst of
   * fragments, which is what a chat transcript needs. A frame that ends the turn
   * flushes immediately rather than waiting out the window.
   */
  onAssistantFrame(payload) {
    const { sessionId, text, completed, toolCall, toolCallShape, chunkType, frameShape, blockShape } = readStreamFrame(payload);
    if (sessionId === void 0) return;
    if (chunkType !== void 0) this.#recordOnce("#chunkTypes", `stream chunk kind: ${chunkType}`);
    if (frameShape !== void 0) this.#recordOnce("#frameShapes", `stream frame shape: ${frameShape}`);
    if (blockShape !== void 0) this.#recordOnce("#blockShapes", `stream block fields: ${blockShape}`);
    if (toolCallShape !== void 0) {
      this.#recordToolShape(toolCallShape);
      return;
    }
    if (toolCall !== void 0) {
      void this.#announceTool(sessionId, toolCall.id, toolCall.name);
      return;
    }
    if ((text === void 0 || text === "") && completed !== true) return;
    void (async () => {
      const bindings = (await this.#store.read()).bindings;
      const conversation = Object.values(bindings).find((entry2) => entry2.sessionId === sessionId);
      if (conversation === void 0) return;
      const existing = this.#replies.get(sessionId);
      if (existing !== void 0) clearTimeout(existing.timer);
      const entry = existing ?? {
        text: "",
        conversationId: conversation.conversationId,
        timer: void 0
      };
      if (text !== void 0) entry.text += text;
      if (completed === true) {
        this.#replies.set(sessionId, entry);
        await this.#flushReply(sessionId);
        const closeTimer = setTimeout(() => {
          void this.closeOpenToolCards(sessionId);
        }, TOOL_CARD_GRACE_MS);
        closeTimer.unref?.();
        return;
      }
      const { settleMs } = this.#settingsNow();
      entry.timer = setTimeout(() => {
        void this.#flushReply(sessionId);
      }, settleMs);
      entry.timer.unref?.();
      this.#replies.set(sessionId, entry);
    })();
  }
  /** Send and clear the buffered reply for a session. */
  async #flushReply(sessionId) {
    const entry = this.#replies.get(sessionId);
    if (entry === void 0) return;
    this.#replies.delete(sessionId);
    const text = entry.text.trim();
    if (text === "") return;
    const state = await this.#store.read();
    const binding = state.bindings[entry.conversationId];
    if (binding === void 0) return;
    const account = state.accounts[binding.accountId];
    if (account === void 0) return;
    await this.#reply(account, binding.conversationId, binding.peerId, text);
  }
  /** Flush everything still buffered. Used on shutdown. */
  async flushReplies() {
    for (const sessionId of [...this.#replies.keys()]) {
      const entry = this.#replies.get(sessionId);
      if (entry !== void 0) clearTimeout(entry.timer);
      await this.#flushReply(sessionId);
    }
  }
  /**
   * Clear every "typing…" indicator and stop its refresh loop. Used on shutdown.
   *
   * Without this the intervals would outlive the plugin and keep calling a monitor that is being
   * torn down, and whichever conversations were mid-turn would be left showing "typing" forever.
   */
  stopTypingAll() {
    for (const conversationId of [...this.#typing.keys()]) this.#stopTyping(conversationId);
  }
  async #account(accountId) {
    return (await this.#store.read()).accounts[accountId];
  }
  #recordError(message) {
    this.#errors.push(`${(/* @__PURE__ */ new Date()).toISOString()} ${message}`);
    if (this.#errors.length > 50) this.#errors.shift();
    console.error(`dsh-wechat-plugin: ${message}`);
  }
  /**
   * Turn a quoted message back into content the agent can read.
   *
   * A quote arrives as an id and nothing else: the inbound `ref_msg.message_item` carries
   * `type: 0`, no text, and only a `msg_id`. So the quoted content exists only in what this
   * channel recorded when it sent the message, and this is the lookup that recovers it.
   *
   * A quote of a message we have no record of is reported rather than silently dropped: the
   * agent then knows a quote was made and could not be read, which is a better answer than
   * acting on an instruction whose subject it never saw.
   *
   * @param message - Inbound message, whose items may carry a quote.
   * @returns A line to lead the prompt with, or undefined when there is no quote.
   */
  async #resolveQuote(message) {
    for (const item of message.raw.item_list ?? []) {
      const quote = item.ref_msg;
      if (quote === void 0) continue;
      const messageId = quote.message_item?.msg_id ?? quote.svr_id;
      if (messageId === void 0) continue;
      const state = await this.#store.read();
      const found = findSentMessage(state, message.accountId, messageId);
      this.#recordBoot(
        `quote resolved: id=${messageId} ${found === void 0 ? "NOT FOUND" : `kind=${found.kind}`}`
      );
      if (found === void 0) {
        return `[\u5F15\u7528\u4E86\u4E00\u6761\u6211\u53D1\u51FA\u7684\u6D88\u606F\uFF0C\u4F46\u5185\u5BB9\u5DF2\u4E0D\u5728\u7F13\u5B58\u4E2D\uFF08id ${messageId}\uFF09]`;
      }
      return found.kind === "text" ? `[\u5F15\u7528\u6211\u6B64\u524D\u53D1\u9001\u7684\u6D88\u606F]
${found.preview}` : `[\u5F15\u7528\u6211\u6B64\u524D\u53D1\u9001\u7684${MEDIA_LABEL_BY_KIND[found.kind]}] ${found.preview}`;
    }
    return void 0;
  }
  /**
   * Note a routine event in the boot log.
   *
   * Media arrivals land here: a download that succeeded and one that was silently
   * skipped look identical from the phone, so the path is written down where the
   * next diagnosis can find it.
   */
  #recordBoot(message) {
    bootLog(this.#home, message);
  }
  /**
   * Record a failure reported by the browser half.
   *
   * Written to the same boot log as host failures, because a client throw is
   * otherwise invisible: it happens in a page the host cannot observe, and the
   * settings page may never even mount.
   */
  recordClientError(scope, message, stack) {
    recordClientFailure(this.#home, scope, message, stack);
    this.#recordError(`\u5BA2\u6237\u7AEF\u9519\u8BEF[${scope}]: ${message}`);
  }
  /**
   * Resolve (or register) the Workspace this channel's sessions live in.
   *
   * Grouping is the whole point: a session created with only a `cwd` shows up in the
   * desktop's "Ungrouped" bucket, and the host rejects a create that names both a
   * `workspaceId` and a `cwd`, so this must supply the workspace instead of the path.
   *
   * Deliberately not swallowed on failure. If the folder cannot be established the
   * channel would keep working but quietly lose its grouping, and the settings page
   * reports the error instead — better one visible failure than silent drift.
   *
   * @returns The Workspace id to pass to `sessionController.create`.
   */
  async #ensureWorkspace() {
    return await this.#workspaceIdFor(this.#workspace, WORKSPACE_TITLE);
  }
  /**
   * Resolve — or create — the workspace owning a directory.
   *
   * Needed because a session can only be adopted with the workspace it already belongs to: the host
   * pins a session's `cwd`, so resuming a conversation from another project means naming *that*
   * project's workspace rather than the channel's own.
   *
   * @param path - Directory the workspace owns.
   * @param title - Title to apply when this is the channel's own workspace.
   * @returns The workspace id, or an empty string when the composition has no registry.
   */
  async #workspaceIdFor(path, title) {
    const registry = this.#ctx.workspaceRegistry;
    if (registry === void 0) {
      if (isSameWorkspace(path, this.#workspace)) {
        this.#recordError("\u6B64\u7EC4\u5408\u6CA1\u6709\u5DE5\u4F5C\u533A\u670D\u52A1\uFF0C\u4F1A\u8BDD\u5C06\u663E\u793A\u5728\u300C\u672A\u5206\u7EC4\u300D\u4E0B");
      }
      return "";
    }
    if (isSameWorkspace(path, this.#workspace) && this.#workspaceId !== void 0) {
      return this.#workspaceId;
    }
    const workspace = await registry.resolveByPath(path) ?? await registry.create(path);
    if (title !== "" && workspace.title !== title) await workspace.setTitle(title);
    if (isSameWorkspace(path, this.#workspace)) this.#workspaceId = workspace.id;
    return workspace.id;
  }
  /**
   * Give a session the permission preset the user chose for WeChat.
   *
   * Why this exists at all: a session whose policy is `ask` sends a permission prompt to WeChat and
   * then waits. On a phone that is a dead end — the user left the desk precisely so they would not
   * have to babysit prompts, and a task that stalls until they answer one is a task they cannot run
   * from WeChat. The default therefore lifts the guardrail for this channel's sessions.
   *
   * Two details that decide whether this works:
   *
   *  - It has to run **before the session's first turn**. DSH rejects a preset change once a turn
   *    has begun (`agent-preset/locked`), so this is called from `ensureSession`, which the router
   *    reaches before it prompts anything — for a new conversation and for a switch alike.
   *  - It is best-effort. The service may be absent on a host that does not compose permission
   *    presets, and a failure here must not cost the user their message: the worst case is that the
   *    session keeps the profile's own policy, which is exactly the old behaviour.
   *
   * @param sessionId - Session that was just created or adopted.
   */
  #applyPermissionPreset(sessionId) {
    const preset = this.#settingsFromDisk().permissionPreset;
    if (preset === "default") return;
    try {
      const sessions = this.#ctx.get("sessions");
      const presets = this.#ctx.get("permissionPresets");
      const session = sessions?.get?.(sessionId);
      if (session === void 0 || presets?.set === void 0) {
        bootLog(
          this.#home,
          `permission preset '${preset}' not applied to ${sessionId}: service unavailable`
        );
        return;
      }
      presets.set(session, preset);
      bootLog(this.#home, `permission preset '${preset}' applied to ${sessionId}`);
    } catch (error) {
      bootLog(this.#home, `permission preset failed for ${sessionId}: ${String(error)}`);
    }
  }
  /** Adapt the host session controller to the router's narrow gateway port. */
  #gateway() {
    const ctx = this.#ctx;
    const cwd = this.#workspace;
    return {
      ensureSession: async (sessionId) => {
        const home = await storedSessionWorkspace(this.#home, sessionId) ?? cwd;
        const workspaceId = await this.#workspaceIdFor(home, isSameWorkspace(home, cwd) ? WORKSPACE_TITLE : "");
        if (workspaceId === "") {
          await ctx.sessionController.create({ sessionId, cwd: home });
          this.#applyPermissionPreset(sessionId);
          return;
        }
        await ctx.sessionController.create({ sessionId, workspaceId });
        this.#applyPermissionPreset(sessionId);
      },
      prompt: async (sessionId, text) => {
        await ctx.sessionController.prompt(
          {
            requestId: `wechat-${randomUUID5()}`,
            sessionId,
            mode: "queue",
            content: [{ type: "text", text }]
          },
          new AbortController().signal
        );
      },
      /*
       * The on-disk store is the only source of sessions.
       *
       * `sessionController.list()` returned an empty array on every run on the machine this was built
       * for, so `/list` answered with nothing while the store held nine conversations for this
       * workspace. It was kept at first as a supplement, but a source that never returns anything is
       * worse than absent: it suggests the channel is showing everything it knows when it is showing
       * what it read from disk, and it says nothing about *where* a session lives — the very field
       * that decides whether it can be adopted.
       *
       * Own-workspace conversations lead in both methods, because those are the ones this chat made.
       */
      listOwnSessions: async () => {
        const { own } = await splitStoredSessions(this.#home, cwd);
        return own;
      },
      listSessions: async () => {
        const { own, others } = await splitStoredSessions(this.#home, cwd);
        return [...own, ...others];
      },
      cancel: async (sessionId) => {
        await ctx.sessionController.cancel({ sessionId });
      }
    };
  }
};
async function splitStoredSessions(home, cwd) {
  const grouped = await listAllStoredSessions(home).catch(() => /* @__PURE__ */ new Map());
  const own = [];
  const others = [];
  for (const [path, sessions] of grouped) {
    const target = isSameWorkspace(path, cwd) ? own : others;
    for (const session of sessions) {
      target.push({ sessionId: session.sessionId, title: session.title, updatedAt: session.updatedAt });
    }
  }
  return { own, others };
}
function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}

\u2026\uFF08\u5DF2\u622A\u65AD\uFF0C\u5B8C\u6574\u5185\u5BB9\u89C1\u684C\u9762\u7AEF\uFF09`;
}
function resolveHome(ctx) {
  const home = ctx.get("homePaths");
  return home?.home ?? process.env.DSH_HOME ?? join4(homedir2(), ".dsh");
}
function resolvePaths(ctx, config) {
  const home = resolveHome(ctx);
  const stateFile = config.stateFile ?? join4(home, "wechat", "state.json");
  const workspace = config.workspace ?? join4(home, WORKSPACE_DIR_NAME);
  mkdirSync(workspace, { recursive: true });
  return { stateFile, workspace };
}
function apply(ctx, config = {}, internals = {}) {
  const home = resolveHome(ctx);
  bootLog(home, "apply: entered");
  try {
    const paths = resolvePaths(ctx, config);
    const runtime = new WechatRuntime(ctx, {
      home,
      stateFile: paths.stateFile,
      workspace: paths.workspace,
      botAgent: config.botAgent ?? "dsh-wechat-plugin/0.0.0",
      ...internals.send === void 0 ? {} : { send: internals.send }
    });
    ctx.provide("wechatChannel", runtime);
    ctx.effect(() => {
      const detachStream = ctx.on(
        "agent/assistant-stream",
        (payload) => {
          runtime.onAssistantFrame(payload);
        },
        { global: true }
      );
      const detachRoutes = registerRoutes(ctx, runtime);
      const detachTool = runtime.registerTools();
      const detachToolResults = ctx.on("tools/result", runtime.toolResultListener(), {
        global: true
      });
      const detachApproval = ctx.on("approval/request", runtime.approvalListener(), {
        global: true,
        prepend: true
      });
      const detachQuestions = ctx.on("user-questions/request", runtime.questionListener(), {
        global: true,
        prepend: true
      });
      void (async () => {
        try {
          if (config.autoStart === true || await runtime.enabled()) await runtime.start();
          bootLog(home, "apply: channel started");
        } catch (error) {
          bootLog(home, `apply: start failed: ${describeError(error)}`);
        }
      })();
      return () => {
        try {
          if (typeof detachStream === "function") detachStream();
          if (typeof detachToolResults === "function") detachToolResults();
          if (typeof detachApproval === "function") detachApproval();
          if (typeof detachQuestions === "function") detachQuestions();
          detachRoutes();
          if (typeof detachTool === "function") detachTool();
          runtime.stopTypingAll();
          void runtime.flushReplies();
          void runtime.halt();
        } catch (error) {
          bootLog(home, `apply: teardown failed: ${describeError(error)}`);
        }
      };
    });
    bootLog(home, "apply: mounted");
    console.error("dsh-wechat-plugin: channel mounted");
  } catch (error) {
    bootLog(home, `apply: FAILED: ${describeError(error)}`);
    if (error instanceof Error && error.stack) bootLog(home, `apply: stack:
${error.stack}`);
    throw error;
  }
}
function bootLog(home, line) {
  try {
    const dir = join4(home, "wechat");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join4(dir, BOOT_LOG_NAME), `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`, "utf-8");
  } catch {
  }
}
function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === void 0 ? "" : ` <- cause: ${describeError(error.cause)}`;
  return `${error.name}: ${error.message}${cause}`;
}
function recordClientFailure(home, scope, message, stack) {
  bootLog(home, `client[${scope}] FAILED: ${message}`);
  if (stack !== "") bootLog(home, `client[${scope}] stack:
${stack}`);
}
function registerRoutes(ctx, runtime) {
  const webServer = ctx.get("webServer");
  if (webServer === void 0) {
    console.error("dsh-wechat-plugin: no webServer, settings routes unavailable");
    return () => {
    };
  }
  return webServer.register({
    kind: "prefix",
    path: "/.dsh-wechat-plugin",
    handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = url.pathname;
      try {
        if (route === ROUTE_STATUS && req.method === "GET") {
          return json(res, 200, await runtime.status());
        }
        if (route === ROUTE_DIAGNOSTICS && req.method === "GET") {
          return json(res, 200, (await runtime.status()).diagnostics);
        }
        if (route === ROUTE_SETTINGS && req.method === "GET") {
          return json(res, 200, await runtime.settingsForPage());
        }
        if (route === ROUTE_SETTINGS && req.method === "POST") {
          const patch = readSettingsPatch(await readJson(req));
          const settings = await runtime.saveSettings(patch);
          return json(res, 200, { settings });
        }
        if (route === ROUTE_DISCONNECT && req.method === "POST") {
          const body = await readJson(req);
          const accountId = typeof body.accountId === "string" ? body.accountId : "";
          const disconnected = await runtime.disconnect(accountId);
          return json(res, disconnected ? 200 : 404, {
            disconnected,
            status: await runtime.status()
          });
        }
        if (route === ROUTE_LOGIN_STATE && req.method === "GET") {
          return json(res, 200, runtime.loginState());
        }
        if (route === ROUTE_LOGIN_START && req.method === "POST") {
          return json(res, 200, await runtime.startLogin());
        }
        if (route === ROUTE_LOGIN_VERIFY && req.method === "POST") {
          const body = await readJson(req);
          const code = typeof body.code === "string" ? body.code : "";
          const accepted = runtime.provideVerifyCode(code);
          return json(res, accepted ? 200 : 409, { accepted });
        }
        if (route === ROUTE_LOGIN_CANCEL && req.method === "POST") {
          runtime.cancelLogin();
          return json(res, 200, { cancelled: true });
        }
        if (route === ROUTE_TOGGLE && req.method === "POST") {
          const body = await readJson(req);
          await runtime.setEnabled(body.enabled === true);
          return json(res, 200, await runtime.status());
        }
        if (route === ROUTE_CLIENT_ERROR && req.method === "POST") {
          const body = await readJson(req);
          const scope = typeof body.scope === "string" ? body.scope : "client";
          const message = typeof body.message === "string" ? body.message : "(\u65E0\u6D88\u606F)";
          const stack = typeof body.stack === "string" ? body.stack : "";
          runtime.recordClientError(scope, message, stack);
          return json(res, 200, { recorded: true });
        }
        return json(res, 404, { error: "not found" });
      } catch (error) {
        return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
}
function readSettingsPatch(body) {
  const patch = {};
  for (const key of ["mergeWindowMs", "maxReplyChars", "settleMs", "quoteHistory"]) {
    const value = body[key];
    const ceiling = key === "maxReplyChars" ? 2e5 : 36e5;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= ceiling) {
      patch[key] = Math.round(value);
    }
  }
  if (typeof body.autoReplyAttachments === "boolean") {
    patch.autoReplyAttachments = body.autoReplyAttachments;
  }
  if (typeof body.requireConfirmation === "boolean") {
    patch.requireConfirmation = body.requireConfirmation;
  }
  if (typeof body.presenceNote === "string") patch.presenceNote = body.presenceNote;
  if (body.permissionPreset === "danger-full-access" || body.permissionPreset === "auto" || body.permissionPreset === "default") {
    patch.permissionPreset = body.permissionPreset;
  }
  if (typeof body.allowCrossSessionNotify === "boolean") {
    patch.allowCrossSessionNotify = body.allowCrossSessionNotify;
  }
  return patch;
}
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}
export {
  WechatRuntime,
  apply,
  inject,
  name,
  recordClientFailure,
  sessionToolDescription
};
