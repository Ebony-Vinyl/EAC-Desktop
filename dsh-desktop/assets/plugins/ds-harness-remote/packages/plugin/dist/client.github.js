"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from == "object" || typeof from == "function")
      for (let key of __getOwnPropNames(from))
        !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target,
    mod
  ));

  // node_modules/qrcode/lib/can-promise.js
  var require_can_promise = __commonJS({
    "node_modules/qrcode/lib/can-promise.js"(exports, module) {
      module.exports = function() {
        return typeof Promise == "function" && Promise.prototype && Promise.prototype.then;
      };
    }
  });

  // node_modules/qrcode/lib/core/utils.js
  var require_utils = __commonJS({
    "node_modules/qrcode/lib/core/utils.js"(exports) {
      var toSJISFunction, CODEWORDS_COUNT = [
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
      exports.getSymbolSize = function(version) {
        if (!version) throw new Error('"version" cannot be null or undefined');
        if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
        return version * 4 + 17;
      };
      exports.getSymbolTotalCodewords = function(version) {
        return CODEWORDS_COUNT[version];
      };
      exports.getBCHDigit = function(data) {
        let digit = 0;
        for (; data !== 0; )
          digit++, data >>>= 1;
        return digit;
      };
      exports.setToSJISFunction = function(f) {
        if (typeof f != "function")
          throw new Error('"toSJISFunc" is not a valid function.');
        toSJISFunction = f;
      };
      exports.isKanjiModeEnabled = function() {
        return typeof toSJISFunction < "u";
      };
      exports.toSJIS = function(kanji) {
        return toSJISFunction(kanji);
      };
    }
  });

  // node_modules/qrcode/lib/core/error-correction-level.js
  var require_error_correction_level = __commonJS({
    "node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
      exports.L = { bit: 1 };
      exports.M = { bit: 0 };
      exports.Q = { bit: 3 };
      exports.H = { bit: 2 };
      function fromString(string) {
        if (typeof string != "string")
          throw new Error("Param is not a string");
        switch (string.toLowerCase()) {
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
      exports.isValid = function(level) {
        return level && typeof level.bit < "u" && level.bit >= 0 && level.bit < 4;
      };
      exports.from = function(value, defaultValue) {
        if (exports.isValid(value))
          return value;
        try {
          return fromString(value);
        } catch {
          return defaultValue;
        }
      };
    }
  });

  // node_modules/qrcode/lib/core/bit-buffer.js
  var require_bit_buffer = __commonJS({
    "node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
      function BitBuffer() {
        this.buffer = [], this.length = 0;
      }
      BitBuffer.prototype = {
        get: function(index) {
          let bufIndex = Math.floor(index / 8);
          return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
        },
        put: function(num, length) {
          for (let i = 0; i < length; i++)
            this.putBit((num >>> length - i - 1 & 1) === 1);
        },
        getLengthInBits: function() {
          return this.length;
        },
        putBit: function(bit) {
          let bufIndex = Math.floor(this.length / 8);
          this.buffer.length <= bufIndex && this.buffer.push(0), bit && (this.buffer[bufIndex] |= 128 >>> this.length % 8), this.length++;
        }
      };
      module.exports = BitBuffer;
    }
  });

  // node_modules/qrcode/lib/core/bit-matrix.js
  var require_bit_matrix = __commonJS({
    "node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
      function BitMatrix(size) {
        if (!size || size < 1)
          throw new Error("BitMatrix size must be defined and greater than 0");
        this.size = size, this.data = new Uint8Array(size * size), this.reservedBit = new Uint8Array(size * size);
      }
      BitMatrix.prototype.set = function(row, col, value, reserved) {
        let index = row * this.size + col;
        this.data[index] = value, reserved && (this.reservedBit[index] = !0);
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

  // node_modules/qrcode/lib/core/alignment-pattern.js
  var require_alignment_pattern = __commonJS({
    "node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
      var getSymbolSize = require_utils().getSymbolSize;
      exports.getRowColCoords = function(version) {
        if (version === 1) return [];
        let posCount = Math.floor(version / 7) + 2, size = getSymbolSize(version), intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2, positions = [size - 7];
        for (let i = 1; i < posCount - 1; i++)
          positions[i] = positions[i - 1] - intervals;
        return positions.push(6), positions.reverse();
      };
      exports.getPositions = function(version) {
        let coords = [], pos = exports.getRowColCoords(version), posLength = pos.length;
        for (let i = 0; i < posLength; i++)
          for (let j = 0; j < posLength; j++)
            i === 0 && j === 0 || // top-left
            i === 0 && j === posLength - 1 || // bottom-left
            i === posLength - 1 && j === 0 || coords.push([pos[i], pos[j]]);
        return coords;
      };
    }
  });

  // node_modules/qrcode/lib/core/finder-pattern.js
  var require_finder_pattern = __commonJS({
    "node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
      var getSymbolSize = require_utils().getSymbolSize, FINDER_PATTERN_SIZE = 7;
      exports.getPositions = function(version) {
        let size = getSymbolSize(version);
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

  // node_modules/qrcode/lib/core/mask-pattern.js
  var require_mask_pattern = __commonJS({
    "node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
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
      exports.isValid = function(mask) {
        return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
      };
      exports.from = function(value) {
        return exports.isValid(value) ? parseInt(value, 10) : void 0;
      };
      exports.getPenaltyN1 = function(data) {
        let size = data.size, points = 0, sameCountCol = 0, sameCountRow = 0, lastCol = null, lastRow = null;
        for (let row = 0; row < size; row++) {
          sameCountCol = sameCountRow = 0, lastCol = lastRow = null;
          for (let col = 0; col < size; col++) {
            let module2 = data.get(row, col);
            module2 === lastCol ? sameCountCol++ : (sameCountCol >= 5 && (points += PenaltyScores.N1 + (sameCountCol - 5)), lastCol = module2, sameCountCol = 1), module2 = data.get(col, row), module2 === lastRow ? sameCountRow++ : (sameCountRow >= 5 && (points += PenaltyScores.N1 + (sameCountRow - 5)), lastRow = module2, sameCountRow = 1);
          }
          sameCountCol >= 5 && (points += PenaltyScores.N1 + (sameCountCol - 5)), sameCountRow >= 5 && (points += PenaltyScores.N1 + (sameCountRow - 5));
        }
        return points;
      };
      exports.getPenaltyN2 = function(data) {
        let size = data.size, points = 0;
        for (let row = 0; row < size - 1; row++)
          for (let col = 0; col < size - 1; col++) {
            let last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
            (last === 4 || last === 0) && points++;
          }
        return points * PenaltyScores.N2;
      };
      exports.getPenaltyN3 = function(data) {
        let size = data.size, points = 0, bitsCol = 0, bitsRow = 0;
        for (let row = 0; row < size; row++) {
          bitsCol = bitsRow = 0;
          for (let col = 0; col < size; col++)
            bitsCol = bitsCol << 1 & 2047 | data.get(row, col), col >= 10 && (bitsCol === 1488 || bitsCol === 93) && points++, bitsRow = bitsRow << 1 & 2047 | data.get(col, row), col >= 10 && (bitsRow === 1488 || bitsRow === 93) && points++;
        }
        return points * PenaltyScores.N3;
      };
      exports.getPenaltyN4 = function(data) {
        let darkCount = 0, modulesCount = data.data.length;
        for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
        return Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10) * PenaltyScores.N4;
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
      exports.applyMask = function(pattern, data) {
        let size = data.size;
        for (let col = 0; col < size; col++)
          for (let row = 0; row < size; row++)
            data.isReserved(row, col) || data.xor(row, col, getMaskAt(pattern, row, col));
      };
      exports.getBestMask = function(data, setupFormatFunc) {
        let numPatterns = Object.keys(exports.Patterns).length, bestPattern = 0, lowerPenalty = 1 / 0;
        for (let p = 0; p < numPatterns; p++) {
          setupFormatFunc(p), exports.applyMask(p, data);
          let penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
          exports.applyMask(p, data), penalty < lowerPenalty && (lowerPenalty = penalty, bestPattern = p);
        }
        return bestPattern;
      };
    }
  });

  // node_modules/qrcode/lib/core/error-correction-code.js
  var require_error_correction_code = __commonJS({
    "node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
      var ECLevel = require_error_correction_level(), EC_BLOCKS_TABLE = [
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
      ], EC_CODEWORDS_TABLE = [
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
      exports.getBlocksCount = function(version, errorCorrectionLevel) {
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
            return;
        }
      };
      exports.getTotalCodewordsCount = function(version, errorCorrectionLevel) {
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
            return;
        }
      };
    }
  });

  // node_modules/qrcode/lib/core/galois-field.js
  var require_galois_field = __commonJS({
    "node_modules/qrcode/lib/core/galois-field.js"(exports) {
      var EXP_TABLE = new Uint8Array(512), LOG_TABLE = new Uint8Array(256);
      (function() {
        let x = 1;
        for (let i = 0; i < 255; i++)
          EXP_TABLE[i] = x, LOG_TABLE[x] = i, x <<= 1, x & 256 && (x ^= 285);
        for (let i = 255; i < 512; i++)
          EXP_TABLE[i] = EXP_TABLE[i - 255];
      })();
      exports.log = function(n) {
        if (n < 1) throw new Error("log(" + n + ")");
        return LOG_TABLE[n];
      };
      exports.exp = function(n) {
        return EXP_TABLE[n];
      };
      exports.mul = function(x, y) {
        return x === 0 || y === 0 ? 0 : EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
      };
    }
  });

  // node_modules/qrcode/lib/core/polynomial.js
  var require_polynomial = __commonJS({
    "node_modules/qrcode/lib/core/polynomial.js"(exports) {
      var GF = require_galois_field();
      exports.mul = function(p1, p2) {
        let coeff = new Uint8Array(p1.length + p2.length - 1);
        for (let i = 0; i < p1.length; i++)
          for (let j = 0; j < p2.length; j++)
            coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        return coeff;
      };
      exports.mod = function(divident, divisor) {
        let result = new Uint8Array(divident);
        for (; result.length - divisor.length >= 0; ) {
          let coeff = result[0];
          for (let i = 0; i < divisor.length; i++)
            result[i] ^= GF.mul(divisor[i], coeff);
          let offset = 0;
          for (; offset < result.length && result[offset] === 0; ) offset++;
          result = result.slice(offset);
        }
        return result;
      };
      exports.generateECPolynomial = function(degree) {
        let poly = new Uint8Array([1]);
        for (let i = 0; i < degree; i++)
          poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
        return poly;
      };
    }
  });

  // node_modules/qrcode/lib/core/reed-solomon-encoder.js
  var require_reed_solomon_encoder = __commonJS({
    "node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
      var Polynomial = require_polynomial();
      function ReedSolomonEncoder(degree) {
        this.genPoly = void 0, this.degree = degree, this.degree && this.initialize(this.degree);
      }
      ReedSolomonEncoder.prototype.initialize = function(degree) {
        this.degree = degree, this.genPoly = Polynomial.generateECPolynomial(this.degree);
      };
      ReedSolomonEncoder.prototype.encode = function(data) {
        if (!this.genPoly)
          throw new Error("Encoder not initialized");
        let paddedData = new Uint8Array(data.length + this.degree);
        paddedData.set(data);
        let remainder = Polynomial.mod(paddedData, this.genPoly), start = this.degree - remainder.length;
        if (start > 0) {
          let buff = new Uint8Array(this.degree);
          return buff.set(remainder, start), buff;
        }
        return remainder;
      };
      module.exports = ReedSolomonEncoder;
    }
  });

  // node_modules/qrcode/lib/core/version-check.js
  var require_version_check = __commonJS({
    "node_modules/qrcode/lib/core/version-check.js"(exports) {
      exports.isValid = function(version) {
        return !isNaN(version) && version >= 1 && version <= 40;
      };
    }
  });

  // node_modules/qrcode/lib/core/regex.js
  var require_regex = __commonJS({
    "node_modules/qrcode/lib/core/regex.js"(exports) {
      var numeric = "[0-9]+", alphanumeric = "[A-Z $%*+\\-./:]+", kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
      kanji = kanji.replace(/u/g, "\\u");
      var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + `)(?:.|[\r
]))+`;
      exports.KANJI = new RegExp(kanji, "g");
      exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
      exports.BYTE = new RegExp(byte, "g");
      exports.NUMERIC = new RegExp(numeric, "g");
      exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
      var TEST_KANJI = new RegExp("^" + kanji + "$"), TEST_NUMERIC = new RegExp("^" + numeric + "$"), TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
      exports.testKanji = function(str) {
        return TEST_KANJI.test(str);
      };
      exports.testNumeric = function(str) {
        return TEST_NUMERIC.test(str);
      };
      exports.testAlphanumeric = function(str) {
        return TEST_ALPHANUMERIC.test(str);
      };
    }
  });

  // node_modules/qrcode/lib/core/mode.js
  var require_mode = __commonJS({
    "node_modules/qrcode/lib/core/mode.js"(exports) {
      var VersionCheck = require_version_check(), Regex = require_regex();
      exports.NUMERIC = {
        id: "Numeric",
        bit: 1,
        ccBits: [10, 12, 14]
      };
      exports.ALPHANUMERIC = {
        id: "Alphanumeric",
        bit: 2,
        ccBits: [9, 11, 13]
      };
      exports.BYTE = {
        id: "Byte",
        bit: 4,
        ccBits: [8, 16, 16]
      };
      exports.KANJI = {
        id: "Kanji",
        bit: 8,
        ccBits: [8, 10, 12]
      };
      exports.MIXED = {
        bit: -1
      };
      exports.getCharCountIndicator = function(mode, version) {
        if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
        if (!VersionCheck.isValid(version))
          throw new Error("Invalid version: " + version);
        return version >= 1 && version < 10 ? mode.ccBits[0] : version < 27 ? mode.ccBits[1] : mode.ccBits[2];
      };
      exports.getBestModeForData = function(dataStr) {
        return Regex.testNumeric(dataStr) ? exports.NUMERIC : Regex.testAlphanumeric(dataStr) ? exports.ALPHANUMERIC : Regex.testKanji(dataStr) ? exports.KANJI : exports.BYTE;
      };
      exports.toString = function(mode) {
        if (mode && mode.id) return mode.id;
        throw new Error("Invalid mode");
      };
      exports.isValid = function(mode) {
        return mode && mode.bit && mode.ccBits;
      };
      function fromString(string) {
        if (typeof string != "string")
          throw new Error("Param is not a string");
        switch (string.toLowerCase()) {
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
      exports.from = function(value, defaultValue) {
        if (exports.isValid(value))
          return value;
        try {
          return fromString(value);
        } catch {
          return defaultValue;
        }
      };
    }
  });

  // node_modules/qrcode/lib/core/version.js
  var require_version = __commonJS({
    "node_modules/qrcode/lib/core/version.js"(exports) {
      var Utils = require_utils(), ECCode = require_error_correction_code(), ECLevel = require_error_correction_level(), Mode = require_mode(), VersionCheck = require_version_check(), G18 = 7973, G18_BCH = Utils.getBCHDigit(G18);
      function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
        for (let currentVersion = 1; currentVersion <= 40; currentVersion++)
          if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode))
            return currentVersion;
      }
      function getReservedBitsCount(mode, version) {
        return Mode.getCharCountIndicator(mode, version) + 4;
      }
      function getTotalBitsFromDataArray(segments, version) {
        let totalBits = 0;
        return segments.forEach(function(data) {
          let reservedBits = getReservedBitsCount(data.mode, version);
          totalBits += reservedBits + data.getBitsLength();
        }), totalBits;
      }
      function getBestVersionForMixedData(segments, errorCorrectionLevel) {
        for (let currentVersion = 1; currentVersion <= 40; currentVersion++)
          if (getTotalBitsFromDataArray(segments, currentVersion) <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED))
            return currentVersion;
      }
      exports.from = function(value, defaultValue) {
        return VersionCheck.isValid(value) ? parseInt(value, 10) : defaultValue;
      };
      exports.getCapacity = function(version, errorCorrectionLevel, mode) {
        if (!VersionCheck.isValid(version))
          throw new Error("Invalid QR Code version");
        typeof mode > "u" && (mode = Mode.BYTE);
        let totalCodewords = Utils.getSymbolTotalCodewords(version), ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel), dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
        if (mode === Mode.MIXED) return dataTotalCodewordsBits;
        let usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
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
      exports.getBestVersionForData = function(data, errorCorrectionLevel) {
        let seg, ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
        if (Array.isArray(data)) {
          if (data.length > 1)
            return getBestVersionForMixedData(data, ecl);
          if (data.length === 0)
            return 1;
          seg = data[0];
        } else
          seg = data;
        return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
      };
      exports.getEncodedBits = function(version) {
        if (!VersionCheck.isValid(version) || version < 7)
          throw new Error("Invalid QR Code version");
        let d = version << 12;
        for (; Utils.getBCHDigit(d) - G18_BCH >= 0; )
          d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
        return version << 12 | d;
      };
    }
  });

  // node_modules/qrcode/lib/core/format-info.js
  var require_format_info = __commonJS({
    "node_modules/qrcode/lib/core/format-info.js"(exports) {
      var Utils = require_utils(), G15 = 1335, G15_MASK = 21522, G15_BCH = Utils.getBCHDigit(G15);
      exports.getEncodedBits = function(errorCorrectionLevel, mask) {
        let data = errorCorrectionLevel.bit << 3 | mask, d = data << 10;
        for (; Utils.getBCHDigit(d) - G15_BCH >= 0; )
          d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
        return (data << 10 | d) ^ G15_MASK;
      };
    }
  });

  // node_modules/qrcode/lib/core/numeric-data.js
  var require_numeric_data = __commonJS({
    "node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
      var Mode = require_mode();
      function NumericData(data) {
        this.mode = Mode.NUMERIC, this.data = data.toString();
      }
      NumericData.getBitsLength = function(length) {
        return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
      };
      NumericData.prototype.getLength = function() {
        return this.data.length;
      };
      NumericData.prototype.getBitsLength = function() {
        return NumericData.getBitsLength(this.data.length);
      };
      NumericData.prototype.write = function(bitBuffer) {
        let i, group, value;
        for (i = 0; i + 3 <= this.data.length; i += 3)
          group = this.data.substr(i, 3), value = parseInt(group, 10), bitBuffer.put(value, 10);
        let remainingNum = this.data.length - i;
        remainingNum > 0 && (group = this.data.substr(i), value = parseInt(group, 10), bitBuffer.put(value, remainingNum * 3 + 1));
      };
      module.exports = NumericData;
    }
  });

  // node_modules/qrcode/lib/core/alphanumeric-data.js
  var require_alphanumeric_data = __commonJS({
    "node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
      var Mode = require_mode(), ALPHA_NUM_CHARS = [
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
        this.mode = Mode.ALPHANUMERIC, this.data = data;
      }
      AlphanumericData.getBitsLength = function(length) {
        return 11 * Math.floor(length / 2) + 6 * (length % 2);
      };
      AlphanumericData.prototype.getLength = function() {
        return this.data.length;
      };
      AlphanumericData.prototype.getBitsLength = function() {
        return AlphanumericData.getBitsLength(this.data.length);
      };
      AlphanumericData.prototype.write = function(bitBuffer) {
        let i;
        for (i = 0; i + 2 <= this.data.length; i += 2) {
          let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
          value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]), bitBuffer.put(value, 11);
        }
        this.data.length % 2 && bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      };
      module.exports = AlphanumericData;
    }
  });

  // node_modules/qrcode/lib/core/byte-data.js
  var require_byte_data = __commonJS({
    "node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
      var Mode = require_mode();
      function ByteData(data) {
        this.mode = Mode.BYTE, typeof data == "string" ? this.data = new TextEncoder().encode(data) : this.data = new Uint8Array(data);
      }
      ByteData.getBitsLength = function(length) {
        return length * 8;
      };
      ByteData.prototype.getLength = function() {
        return this.data.length;
      };
      ByteData.prototype.getBitsLength = function() {
        return ByteData.getBitsLength(this.data.length);
      };
      ByteData.prototype.write = function(bitBuffer) {
        for (let i = 0, l = this.data.length; i < l; i++)
          bitBuffer.put(this.data[i], 8);
      };
      module.exports = ByteData;
    }
  });

  // node_modules/qrcode/lib/core/kanji-data.js
  var require_kanji_data = __commonJS({
    "node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
      var Mode = require_mode(), Utils = require_utils();
      function KanjiData(data) {
        this.mode = Mode.KANJI, this.data = data;
      }
      KanjiData.getBitsLength = function(length) {
        return length * 13;
      };
      KanjiData.prototype.getLength = function() {
        return this.data.length;
      };
      KanjiData.prototype.getBitsLength = function() {
        return KanjiData.getBitsLength(this.data.length);
      };
      KanjiData.prototype.write = function(bitBuffer) {
        let i;
        for (i = 0; i < this.data.length; i++) {
          let value = Utils.toSJIS(this.data[i]);
          if (value >= 33088 && value <= 40956)
            value -= 33088;
          else if (value >= 57408 && value <= 60351)
            value -= 49472;
          else
            throw new Error(
              "Invalid SJIS character: " + this.data[i] + `
Make sure your charset is UTF-8`
            );
          value = (value >>> 8 & 255) * 192 + (value & 255), bitBuffer.put(value, 13);
        }
      };
      module.exports = KanjiData;
    }
  });

  // node_modules/dijkstrajs/dijkstra.js
  var require_dijkstra = __commonJS({
    "node_modules/dijkstrajs/dijkstra.js"(exports, module) {
      "use strict";
      var dijkstra = {
        single_source_shortest_paths: function(graph, s, d) {
          var predecessors = {}, costs = {};
          costs[s] = 0;
          var open = dijkstra.PriorityQueue.make();
          open.push(s, 0);
          for (var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit; !open.empty(); ) {
            closest = open.pop(), u = closest.value, cost_of_s_to_u = closest.cost, adjacent_nodes = graph[u] || {};
            for (v in adjacent_nodes)
              adjacent_nodes.hasOwnProperty(v) && (cost_of_e = adjacent_nodes[v], cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e, cost_of_s_to_v = costs[v], first_visit = typeof costs[v] > "u", (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) && (costs[v] = cost_of_s_to_u_plus_cost_of_e, open.push(v, cost_of_s_to_u_plus_cost_of_e), predecessors[v] = u));
          }
          if (typeof d < "u" && typeof costs[d] > "u") {
            var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
            throw new Error(msg);
          }
          return predecessors;
        },
        extract_shortest_path_from_predecessor_list: function(predecessors, d) {
          for (var nodes = [], u = d, predecessor; u; )
            nodes.push(u), predecessor = predecessors[u], u = predecessors[u];
          return nodes.reverse(), nodes;
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
            for (key in T)
              T.hasOwnProperty(key) && (t[key] = T[key]);
            return t.queue = [], t.sorter = opts.sorter || T.default_sorter, t;
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
            this.queue.push(item), this.queue.sort(this.sorter);
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
      typeof module < "u" && (module.exports = dijkstra);
    }
  });

  // node_modules/qrcode/lib/core/segments.js
  var require_segments = __commonJS({
    "node_modules/qrcode/lib/core/segments.js"(exports) {
      var Mode = require_mode(), NumericData = require_numeric_data(), AlphanumericData = require_alphanumeric_data(), ByteData = require_byte_data(), KanjiData = require_kanji_data(), Regex = require_regex(), Utils = require_utils(), dijkstra = require_dijkstra();
      function getStringByteLength(str) {
        return unescape(encodeURIComponent(str)).length;
      }
      function getSegments(regex, mode, str) {
        let segments = [], result;
        for (; (result = regex.exec(str)) !== null; )
          segments.push({
            data: result[0],
            index: result.index,
            mode,
            length: result[0].length
          });
        return segments;
      }
      function getSegmentsFromString(dataStr) {
        let numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr), alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr), byteSegs, kanjiSegs;
        return Utils.isKanjiModeEnabled() ? (byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr), kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr)) : (byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr), kanjiSegs = []), numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs).sort(function(s1, s2) {
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
          let prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
          return prevSeg && prevSeg.mode === curr.mode ? (acc[acc.length - 1].data += curr.data, acc) : (acc.push(curr), acc);
        }, []);
      }
      function buildNodes(segs) {
        let nodes = [];
        for (let i = 0; i < segs.length; i++) {
          let seg = segs[i];
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
        let table = {}, graph = { start: {} }, prevNodeIds = ["start"];
        for (let i = 0; i < nodes.length; i++) {
          let nodeGroup = nodes[i], currentNodeIds = [];
          for (let j = 0; j < nodeGroup.length; j++) {
            let node = nodeGroup[j], key = "" + i + j;
            currentNodeIds.push(key), table[key] = { node, lastCount: 0 }, graph[key] = {};
            for (let n = 0; n < prevNodeIds.length; n++) {
              let prevNodeId = prevNodeIds[n];
              table[prevNodeId] && table[prevNodeId].node.mode === node.mode ? (graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode), table[prevNodeId].lastCount += node.length) : (table[prevNodeId] && (table[prevNodeId].lastCount = node.length), graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version));
            }
          }
          prevNodeIds = currentNodeIds;
        }
        for (let n = 0; n < prevNodeIds.length; n++)
          graph[prevNodeIds[n]].end = 0;
        return { map: graph, table };
      }
      function buildSingleSegment(data, modesHint) {
        let mode, bestMode = Mode.getBestModeForData(data);
        if (mode = Mode.from(modesHint, bestMode), mode !== Mode.BYTE && mode.bit < bestMode.bit)
          throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + `.
 Suggested mode is: ` + Mode.toString(bestMode));
        switch (mode === Mode.KANJI && !Utils.isKanjiModeEnabled() && (mode = Mode.BYTE), mode) {
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
      exports.fromArray = function(array) {
        return array.reduce(function(acc, seg) {
          return typeof seg == "string" ? acc.push(buildSingleSegment(seg, null)) : seg.data && acc.push(buildSingleSegment(seg.data, seg.mode)), acc;
        }, []);
      };
      exports.fromString = function(data, version) {
        let segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled()), nodes = buildNodes(segs), graph = buildGraph(nodes, version), path = dijkstra.find_path(graph.map, "start", "end"), optimizedSegs = [];
        for (let i = 1; i < path.length - 1; i++)
          optimizedSegs.push(graph.table[path[i]].node);
        return exports.fromArray(mergeSegments(optimizedSegs));
      };
      exports.rawSplit = function(data) {
        return exports.fromArray(
          getSegmentsFromString(data, Utils.isKanjiModeEnabled())
        );
      };
    }
  });

  // node_modules/qrcode/lib/core/qrcode.js
  var require_qrcode = __commonJS({
    "node_modules/qrcode/lib/core/qrcode.js"(exports) {
      var Utils = require_utils(), ECLevel = require_error_correction_level(), BitBuffer = require_bit_buffer(), BitMatrix = require_bit_matrix(), AlignmentPattern = require_alignment_pattern(), FinderPattern = require_finder_pattern(), MaskPattern = require_mask_pattern(), ECCode = require_error_correction_code(), ReedSolomonEncoder = require_reed_solomon_encoder(), Version = require_version(), FormatInfo = require_format_info(), Mode = require_mode(), Segments = require_segments();
      function setupFinderPattern(matrix, version) {
        let size = matrix.size, pos = FinderPattern.getPositions(version);
        for (let i = 0; i < pos.length; i++) {
          let row = pos[i][0], col = pos[i][1];
          for (let r = -1; r <= 7; r++)
            if (!(row + r <= -1 || size <= row + r))
              for (let c = -1; c <= 7; c++)
                col + c <= -1 || size <= col + c || (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4 ? matrix.set(row + r, col + c, !0, !0) : matrix.set(row + r, col + c, !1, !0));
        }
      }
      function setupTimingPattern(matrix) {
        let size = matrix.size;
        for (let r = 8; r < size - 8; r++) {
          let value = r % 2 === 0;
          matrix.set(r, 6, value, !0), matrix.set(6, r, value, !0);
        }
      }
      function setupAlignmentPattern(matrix, version) {
        let pos = AlignmentPattern.getPositions(version);
        for (let i = 0; i < pos.length; i++) {
          let row = pos[i][0], col = pos[i][1];
          for (let r = -2; r <= 2; r++)
            for (let c = -2; c <= 2; c++)
              r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0 ? matrix.set(row + r, col + c, !0, !0) : matrix.set(row + r, col + c, !1, !0);
        }
      }
      function setupVersionInfo(matrix, version) {
        let size = matrix.size, bits = Version.getEncodedBits(version), row, col, mod;
        for (let i = 0; i < 18; i++)
          row = Math.floor(i / 3), col = i % 3 + size - 8 - 3, mod = (bits >> i & 1) === 1, matrix.set(row, col, mod, !0), matrix.set(col, row, mod, !0);
      }
      function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
        let size = matrix.size, bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern), i, mod;
        for (i = 0; i < 15; i++)
          mod = (bits >> i & 1) === 1, i < 6 ? matrix.set(i, 8, mod, !0) : i < 8 ? matrix.set(i + 1, 8, mod, !0) : matrix.set(size - 15 + i, 8, mod, !0), i < 8 ? matrix.set(8, size - i - 1, mod, !0) : i < 9 ? matrix.set(8, 15 - i - 1 + 1, mod, !0) : matrix.set(8, 15 - i - 1, mod, !0);
        matrix.set(size - 8, 8, 1, !0);
      }
      function setupData(matrix, data) {
        let size = matrix.size, inc = -1, row = size - 1, bitIndex = 7, byteIndex = 0;
        for (let col = size - 1; col > 0; col -= 2)
          for (col === 6 && col--; ; ) {
            for (let c = 0; c < 2; c++)
              if (!matrix.isReserved(row, col - c)) {
                let dark = !1;
                byteIndex < data.length && (dark = (data[byteIndex] >>> bitIndex & 1) === 1), matrix.set(row, col - c, dark), bitIndex--, bitIndex === -1 && (byteIndex++, bitIndex = 7);
              }
            if (row += inc, row < 0 || size <= row) {
              row -= inc, inc = -inc;
              break;
            }
          }
      }
      function createData(version, errorCorrectionLevel, segments) {
        let buffer = new BitBuffer();
        segments.forEach(function(data) {
          buffer.put(data.mode.bit, 4), buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version)), data.write(buffer);
        });
        let totalCodewords = Utils.getSymbolTotalCodewords(version), ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel), dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
        for (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits && buffer.put(0, 4); buffer.getLengthInBits() % 8 !== 0; )
          buffer.putBit(0);
        let remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
        for (let i = 0; i < remainingByte; i++)
          buffer.put(i % 2 ? 17 : 236, 8);
        return createCodewords(buffer, version, errorCorrectionLevel);
      }
      function createCodewords(bitBuffer, version, errorCorrectionLevel) {
        let totalCodewords = Utils.getSymbolTotalCodewords(version), ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel), dataTotalCodewords = totalCodewords - ecTotalCodewords, ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel), blocksInGroup2 = totalCodewords % ecTotalBlocks, blocksInGroup1 = ecTotalBlocks - blocksInGroup2, totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks), dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks), dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1, ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1, rs = new ReedSolomonEncoder(ecCount), offset = 0, dcData = new Array(ecTotalBlocks), ecData = new Array(ecTotalBlocks), maxDataSize = 0, buffer = new Uint8Array(bitBuffer.buffer);
        for (let b = 0; b < ecTotalBlocks; b++) {
          let dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
          dcData[b] = buffer.slice(offset, offset + dataSize), ecData[b] = rs.encode(dcData[b]), offset += dataSize, maxDataSize = Math.max(maxDataSize, dataSize);
        }
        let data = new Uint8Array(totalCodewords), index = 0, i, r;
        for (i = 0; i < maxDataSize; i++)
          for (r = 0; r < ecTotalBlocks; r++)
            i < dcData[r].length && (data[index++] = dcData[r][i]);
        for (i = 0; i < ecCount; i++)
          for (r = 0; r < ecTotalBlocks; r++)
            data[index++] = ecData[r][i];
        return data;
      }
      function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
        let segments;
        if (Array.isArray(data))
          segments = Segments.fromArray(data);
        else if (typeof data == "string") {
          let estimatedVersion = version;
          if (!estimatedVersion) {
            let rawSegments = Segments.rawSplit(data);
            estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
          }
          segments = Segments.fromString(data, estimatedVersion || 40);
        } else
          throw new Error("Invalid data");
        let bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
        if (!bestVersion)
          throw new Error("The amount of data is too big to be stored in a QR Code");
        if (!version)
          version = bestVersion;
        else if (version < bestVersion)
          throw new Error(
            `
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: ` + bestVersion + `.
`
          );
        let dataBits = createData(version, errorCorrectionLevel, segments), moduleCount = Utils.getSymbolSize(version), modules = new BitMatrix(moduleCount);
        return setupFinderPattern(modules, version), setupTimingPattern(modules), setupAlignmentPattern(modules, version), setupFormatInfo(modules, errorCorrectionLevel, 0), version >= 7 && setupVersionInfo(modules, version), setupData(modules, dataBits), isNaN(maskPattern) && (maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        )), MaskPattern.applyMask(maskPattern, modules), setupFormatInfo(modules, errorCorrectionLevel, maskPattern), {
          modules,
          version,
          errorCorrectionLevel,
          maskPattern,
          segments
        };
      }
      exports.create = function(data, options) {
        if (typeof data > "u" || data === "")
          throw new Error("No input text");
        let errorCorrectionLevel = ECLevel.M, version, mask;
        return typeof options < "u" && (errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M), version = Version.from(options.version), mask = MaskPattern.from(options.maskPattern), options.toSJISFunc && Utils.setToSJISFunction(options.toSJISFunc)), createSymbol(data, version, errorCorrectionLevel, mask);
      };
    }
  });

  // node_modules/qrcode/lib/renderer/utils.js
  var require_utils2 = __commonJS({
    "node_modules/qrcode/lib/renderer/utils.js"(exports) {
      function hex2rgba(hex) {
        if (typeof hex == "number" && (hex = hex.toString()), typeof hex != "string")
          throw new Error("Color should be defined as hex string");
        let hexCode = hex.slice().replace("#", "").split("");
        if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8)
          throw new Error("Invalid hex color: " + hex);
        (hexCode.length === 3 || hexCode.length === 4) && (hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }))), hexCode.length === 6 && hexCode.push("F", "F");
        let hexValue = parseInt(hexCode.join(""), 16);
        return {
          r: hexValue >> 24 & 255,
          g: hexValue >> 16 & 255,
          b: hexValue >> 8 & 255,
          a: hexValue & 255,
          hex: "#" + hexCode.slice(0, 6).join("")
        };
      }
      exports.getOptions = function(options) {
        options || (options = {}), options.color || (options.color = {});
        let margin = typeof options.margin > "u" || options.margin === null || options.margin < 0 ? 4 : options.margin, width = options.width && options.width >= 21 ? options.width : void 0, scale = options.scale || 4;
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
      exports.getScale = function(qrSize, opts) {
        return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
      };
      exports.getImageWidth = function(qrSize, opts) {
        let scale = exports.getScale(qrSize, opts);
        return Math.floor((qrSize + opts.margin * 2) * scale);
      };
      exports.qrToImageData = function(imgData, qr, opts) {
        let size = qr.modules.size, data = qr.modules.data, scale = exports.getScale(size, opts), symbolSize = Math.floor((size + opts.margin * 2) * scale), scaledMargin = opts.margin * scale, palette = [opts.color.light, opts.color.dark];
        for (let i = 0; i < symbolSize; i++)
          for (let j = 0; j < symbolSize; j++) {
            let posDst = (i * symbolSize + j) * 4, pxColor = opts.color.light;
            if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
              let iSrc = Math.floor((i - scaledMargin) / scale), jSrc = Math.floor((j - scaledMargin) / scale);
              pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
            }
            imgData[posDst++] = pxColor.r, imgData[posDst++] = pxColor.g, imgData[posDst++] = pxColor.b, imgData[posDst] = pxColor.a;
          }
      };
    }
  });

  // node_modules/qrcode/lib/renderer/canvas.js
  var require_canvas = __commonJS({
    "node_modules/qrcode/lib/renderer/canvas.js"(exports) {
      var Utils = require_utils2();
      function clearCanvas(ctx, canvas, size) {
        ctx.clearRect(0, 0, canvas.width, canvas.height), canvas.style || (canvas.style = {}), canvas.height = size, canvas.width = size, canvas.style.height = size + "px", canvas.style.width = size + "px";
      }
      function getCanvasElement() {
        try {
          return document.createElement("canvas");
        } catch {
          throw new Error("You need to specify a canvas element");
        }
      }
      exports.render = function(qrData, canvas, options) {
        let opts = options, canvasEl = canvas;
        typeof opts > "u" && (!canvas || !canvas.getContext) && (opts = canvas, canvas = void 0), canvas || (canvasEl = getCanvasElement()), opts = Utils.getOptions(opts);
        let size = Utils.getImageWidth(qrData.modules.size, opts), ctx = canvasEl.getContext("2d"), image = ctx.createImageData(size, size);
        return Utils.qrToImageData(image.data, qrData, opts), clearCanvas(ctx, canvasEl, size), ctx.putImageData(image, 0, 0), canvasEl;
      };
      exports.renderToDataURL = function(qrData, canvas, options) {
        let opts = options;
        typeof opts > "u" && (!canvas || !canvas.getContext) && (opts = canvas, canvas = void 0), opts || (opts = {});
        let canvasEl = exports.render(qrData, canvas, opts), type = opts.type || "image/png", rendererOpts = opts.rendererOpts || {};
        return canvasEl.toDataURL(type, rendererOpts.quality);
      };
    }
  });

  // node_modules/qrcode/lib/renderer/svg-tag.js
  var require_svg_tag = __commonJS({
    "node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
      var Utils = require_utils2();
      function getColorAttrib(color, attrib) {
        let alpha = color.a / 255, str = attrib + '="' + color.hex + '"';
        return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
      }
      function svgCmd(cmd, x, y) {
        let str = cmd + x;
        return typeof y < "u" && (str += " " + y), str;
      }
      function qrToPath(data, size, margin) {
        let path = "", moveBy = 0, newRow = !1, lineLength = 0;
        for (let i = 0; i < data.length; i++) {
          let col = Math.floor(i % size), row = Math.floor(i / size);
          !col && !newRow && (newRow = !0), data[i] ? (lineLength++, i > 0 && col > 0 && data[i - 1] || (path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0), moveBy = 0, newRow = !1), col + 1 < size && data[i + 1] || (path += svgCmd("h", lineLength), lineLength = 0)) : moveBy++;
        }
        return path;
      }
      exports.render = function(qrData, options, cb) {
        let opts = Utils.getOptions(options), size = qrData.modules.size, data = qrData.modules.data, qrcodesize = size + opts.margin * 2, bg = opts.color.light.a ? "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>' : "", path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>', viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"', svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + (opts.width ? 'width="' + opts.width + '" height="' + opts.width + '" ' : "") + viewBox + ' shape-rendering="crispEdges">' + bg + path + `</svg>
`;
        return typeof cb == "function" && cb(null, svgTag), svgTag;
      };
    }
  });

  // node_modules/qrcode/lib/browser.js
  var require_browser = __commonJS({
    "node_modules/qrcode/lib/browser.js"(exports) {
      var canPromise = require_can_promise(), QRCode2 = require_qrcode(), CanvasRenderer = require_canvas(), SvgRenderer = require_svg_tag();
      function renderCanvas(renderFunc, canvas, text, opts, cb) {
        let args = [].slice.call(arguments, 1), argsNum = args.length, isLastArgCb = typeof args[argsNum - 1] == "function";
        if (!isLastArgCb && !canPromise())
          throw new Error("Callback required as last argument");
        if (isLastArgCb) {
          if (argsNum < 2)
            throw new Error("Too few arguments provided");
          argsNum === 2 ? (cb = text, text = canvas, canvas = opts = void 0) : argsNum === 3 && (canvas.getContext && typeof cb > "u" ? (cb = opts, opts = void 0) : (cb = opts, opts = text, text = canvas, canvas = void 0));
        } else {
          if (argsNum < 1)
            throw new Error("Too few arguments provided");
          return argsNum === 1 ? (text = canvas, canvas = opts = void 0) : argsNum === 2 && !canvas.getContext && (opts = text, text = canvas, canvas = void 0), new Promise(function(resolve, reject) {
            try {
              let data = QRCode2.create(text, opts);
              resolve(renderFunc(data, canvas, opts));
            } catch (e) {
              reject(e);
            }
          });
        }
        try {
          let data = QRCode2.create(text, opts);
          cb(null, renderFunc(data, canvas, opts));
        } catch (e) {
          cb(e);
        }
      }
      exports.create = QRCode2.create;
      exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
      exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
      exports.toString = renderCanvas.bind(null, function(data, _, opts) {
        return SvgRenderer.render(data, opts);
      });
    }
  });

  // src/client.ts
  var import_qrcode = __toESM(require_browser(), 1);

  // src/remote-file-content-provider.ts
  function shouldUseRemoteFileViewer(status) {
    return status.mode === "remote" && status.remoteFeatures?.fileViewer === !0;
  }
  var REMOTE_FILE_SAVE_AS_MAX_BYTES = 100 * 1024 * 1024, REMOTE_FILE_FAST_SAVE_AS_MAX_BYTES = 1024 * 1024 * 1024;
  function shouldAllowRemoteFileSaveAs(status) {
    return shouldUseRemoteFileViewer(status) && (status.transport === "LAN" || status.transport === "P2P" || status.transport === "TURN");
  }
  function remoteFileSaveAsMaxBytes(status) {
    return status.transport === "LAN" || status.transport === "P2P" ? REMOTE_FILE_FAST_SAVE_AS_MAX_BYTES : REMOTE_FILE_SAVE_AS_MAX_BYTES;
  }
  function createRemoteFileContentProvider(call, options = {}) {
    return {
      id: "dsh-remote-files",
      priority: 1e4,
      supports: () => !0,
      saveAsAllowed: () => ({
        allowed: currentSaveAsAllowed(options.saveAsAllowed),
        maxBytes: currentSaveAsMaxBytes(options.saveAsMaxBytes)
      }),
      async stat(locator, signal) {
        let value = await call("fileviewer.stat", { path: locator }, signal);
        if (value.exists)
          return {
            name: value.name,
            size: value.isDirectory ? 0 : value.size,
            mime: value.mime,
            mtimeMs: value.mtimeMs,
            isDirectory: value.isDirectory
          };
      },
      async read(locator, request) {
        if (!Number.isInteger(request.offset) || request.offset < 0) throw new Error("A non-negative integer offset is required.");
        if (!Number.isInteger(request.length) || request.length <= 0) throw new Error("A positive integer length is required.");
        let chunks = [], received = 0;
        for (; received < request.length; ) {
          request.signal.throwIfAborted();
          let length = Math.min(524288, request.length - received), offset = request.offset + received, range = await call("fileviewer.readRange", { path: locator, offset, length }, request.signal);
          if (range.offset !== offset) throw new Error("The Remote Host returned a mismatched file range.");
          let bytes = decodeBase64(range.data);
          if (bytes.byteLength > length) throw new Error("The Remote Host returned more file bytes than requested.");
          if (chunks.push(bytes), received += bytes.byteLength, range.eof || bytes.byteLength === 0) break;
        }
        let merged = new Uint8Array(received), cursor = 0;
        for (let chunk of chunks)
          merged.set(chunk, cursor), cursor += chunk.byteLength;
        return merged;
      },
      async list(locator, signal) {
        return (await call("fileviewer.list", { path: locator }, signal)).entries.map((entry) => ({
          locator: entry.path,
          name: entry.name,
          size: entry.isDirectory ? 0 : entry.size ?? 0,
          mtimeMs: entry.mtimeMs,
          isDirectory: entry.isDirectory
        }));
      }
    };
  }
  function currentSaveAsAllowed(value) {
    return typeof value == "function" ? value() : value === !0;
  }
  function currentSaveAsMaxBytes(value) {
    return typeof value == "function" ? value() : value ?? REMOTE_FILE_SAVE_AS_MAX_BYTES;
  }
  function decodeBase64(value) {
    let binary = atob(value), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  // src/control-route.ts
  var CONTROL_RPC_PREFIX = "/ds-harness-remote", STATUS_STREAM_ENDPOINT = "status.events", STATUS_STREAM_PATH = `${CONTROL_RPC_PREFIX}/${STATUS_STREAM_ENDPOINT}`;

  // src/status-stream.ts
  function parseStatus(data) {
    if (typeof data == "string")
      try {
        let parsed = JSON.parse(data);
        return parsed === null || typeof parsed != "object" ? void 0 : parsed;
      } catch {
        return;
      }
  }
  function createStatusFeed(options) {
    let listeners = /* @__PURE__ */ new Set(), pollIntervalMs = options.pollIntervalMs ?? 1500, openTimeoutMs = options.openTimeoutMs ?? 4e3, createSource = options.createSource ?? ((url) => new EventSource(url)), status, source, openTimer, pollTimer, publish = (next) => {
      status = next;
      for (let listener of [...listeners]) listener(next);
    }, teardown = () => {
      openTimer !== void 0 && (clearTimeout(openTimer), openTimer = void 0), pollTimer !== void 0 && (clearInterval(pollTimer), pollTimer = void 0), source?.close(), source = void 0;
    }, poll = () => {
      options.readStatus().then((next) => {
        pollTimer !== void 0 && publish(next);
      }).catch(() => {
      });
    }, fallbackToPolling = (reason) => {
      pollTimer !== void 0 || listeners.size === 0 || (openTimer !== void 0 && (clearTimeout(openTimer), openTimer = void 0), source?.close(), source = void 0, options.onFallback?.(reason), poll(), pollTimer = setInterval(poll, pollIntervalMs));
    }, openStream = () => {
      let opened;
      try {
        opened = createSource(options.url);
      } catch {
        fallbackToPolling("unsupported");
        return;
      }
      source = opened;
      let received = !1;
      openTimer = setTimeout(() => {
        received || fallbackToPolling("silent");
      }, openTimeoutMs), opened.onmessage = (event) => {
        received = !0, openTimer !== void 0 && (clearTimeout(openTimer), openTimer = void 0);
        let next = parseStatus(event.data);
        next !== void 0 && publish(next);
      }, opened.onerror = () => {
        opened.readyState === 2 && fallbackToPolling("unavailable");
      };
    };
    return {
      getSnapshot: () => status,
      subscribe: (listener) => (listeners.add(listener), status !== void 0 && listener(status), listeners.size === 1 && openStream(), () => {
        listeners.delete(listener), listeners.size === 0 && teardown();
      }),
      close: () => {
        listeners.clear(), teardown();
      }
    };
  }

  // src/client.ts
  var clientModuleId = "ds-harness-remote", pendingWorkspaceSelectionKey = "dsh-remote:pending-workspace-selection", deepSeekWorkspaceIcon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAACVBMVEUAAADy8vXx8fUsA3vyAAAAAXRSTlMAQObYZgAAAOxJREFUWMPtlsEOwyAMQxP+/6OnTZMGxHGcot3wDYgfhkJbs6urprzveGtu9d1NgEdto8w93GuA7zPS2RFg7ynsCOAokbtAmLr2YaeKgJ6fxpT8jCAC0qSqPyNoO5DXdvyouj4ClFAdYaDxK09uiBDCIYBf6CxLesnR0uF2pG+JmhCqrUb0AOvjjoQaYDTCEAAgMg5grhAeAQIB+/M15IcKlnUIp4CkTCd0AKb4zVsRSJVGYEVzT0agK107IMGMEurvromEpaX4wzk/IKw378kq4LafED6Oowxfk7AP2q8W16EdM3p29Eyvrv6vF0WIBfBziKyCAAAAAElFTkSuQmCC", gptWorkspaceIcon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAclBMVEX////v7+++wMf////s7O3k5OTExcrX2Ny6vMTv8PPW19yXmqRqboJmaHd3eoaqrLPs7fGMjpfb3eKlpq1eYXOxs7pWWWd+gY5HSVdRVGVub3k+QU74+Pg4OkcvMT1ISlUoKjUiIy4fICueoKkaGyUSFB21Bp+qAAAAAXRSTlMAQObYZgAABChJREFUWMPtl916qjoQhlsdEwIECEgMYCBxx/u/xT1DrFUL1LO1DtY8LSLJvPnmB4gfH//sr7TPDfvdebf/xXZbkE/4zZ0MVhGHd9zJDsv+7F3//Z69tT5wljAu3tXw+TIlzXKJlhflYmJ+5uF5WpWhb54X+C/zZCmT2wJA4dJZwus0UYjIGqWyMhVbEp4yKNRRqlv0opW5PJLJ4rFJXvP4JKDRMqturBZjkMVJFYjR6iHQDQDI4+k2k51wZbWrqwp4mR/1CVYATyko9TFGxBUqL5IvMbXSWt0T8bkGgFLqgqZBI/Uxbx5UAxLaNcCNLBpttM7wbCc1pmJOpWAsDtey68UaQMyrFgb9uxLPjqg3+nGluyKN0XUdWw0BJ0NvTFFqgzpr9J+Dh4w0Ga1qkqBNswagxdRgFPAbgHRQG5jumGWyMxrTIaRRa4AzFs0YrNMXgI4MJWnsKYFhGNMnIh/mBOPsV8CZBFjN9w8ArowxnZzDr5IcvxTaKpxJCVsoI3SWysz1UM4AqQdzlCgho1IKrK+x1mKFzisANtgEU8E7GwHDgOqxe4w9tnM166wbaA2xBMBLrTWcAGYGdCiYVUJUrMCF+7l6gklrW1RwPi8ByjuActANqhKzVWoYrFGcCFzbDgNaBrTWpncFQMcI2DfWoAiDqRCiHcYM/ZdCEKkZqfR8spj4F0CiJjv2gHL6URNoCQDaYacL6O1oFDO2eQDUFP7AKdCRdC4CRDZaNifbjA41l/uYb/SZMAFNTBGzY7sG4J2jTsJgToOzIzXF3HZqBpSOAGduXbkGEKV1OqVGqRJpRxtvwbSw5IqAiUJItwBCOT9R32FCGo3nCkAN3t0UTBRC6zDONcBeOee9pr4T+ASbnDOdc5OmtREwEEB5w8Wqgt4bOV5c7Lt9iiK8zdP/IsBbutUGX4gNwEVCqd3FUt/xYnRWt7BvPBYQjwjAGXa3ASguHVAZ/WXKlA3eZDX1wRegFsr7E2wAlB9xFbx/7MV70kFT8aqNgLL3F8nFBmA3hrn/IJHjKJOK2oj1WI4Z4FzwN/81AOhgYD6v2xbIvaZIurLC9AfvB1WLTYAoXejF1xeBL5cpBIyEbmxkZymIXwDQh1BAfOrhI1lfwtgz8tozF5T4ttf3+32AyxC6klwAgw/YVTHpoK82xYt3wLP/Bw4AAI4D7/01TLKXBj9NEz2wEuGiKpoy68S/FwCLMQAZ3gXhihaCa25vQo6RyToOz9PE6wYjJgGi1YnqZX8qMIK+TDlnargGzSv4NvFjlwXf/nfLLMrAB4O/Xl3BH0d+RIASFgDA8IYMIXgr2+cBsbDdPSwAAHjSZFmb3txETCKIxc0uWwI8rxsLJcTiVndNwyMgKljbbNN2/zcEAja2+4RgIDYN2Bu/WtAOaEodnu2dnzz/7I/Y/w/LaEcX/MdfAAAAAElFTkSuQmCC";
  function storedWorkspaceSelection() {
    let raw = window.sessionStorage.getItem(pendingWorkspaceSelectionKey);
    if (raw !== null)
      try {
        let value = JSON.parse(raw);
        if (typeof value.targetDeviceId != "string" || typeof value.workspaceId != "string") throw new Error("invalid");
        if (value.backend !== void 0 && value.backend !== "harness" && value.backend !== "codex" && value.backend !== "cursor" && value.backend !== "antigravity") throw new Error("invalid");
        if (value.sessionId !== void 0 && typeof value.sessionId != "string") throw new Error("invalid");
        return value;
      } catch {
        window.sessionStorage.removeItem(pendingWorkspaceSelectionKey);
        return;
      }
  }
  function workspacesReady(snapshot) {
    return snapshot.baselinesReady === !0 || snapshot.phase === "ready";
  }
  var localeNamespace = "ds-harness-remote", en = {
    terminalRemote: "Remote terminal",
    terminalRemoteHint: "Allow trusted Remote devices to run an interactive shell as this Host user. On by default; independent of Agent approvals. Toggling saves and applies immediately.",
    terminalRemoteUnavailable: "Remote terminal is unavailable. Enable Remote terminal in the Host Remote settings; the switch applies immediately.",
    previewPorts: "Remote preview ports",
    previewPortsHint: "Allow specific Host ports (1024\u201365535), separated by commas. Empty disables preview. HTTP, WebSocket and hot reload are supported.",
    developmentSave: "Save access settings",
    developmentSaved: "Remote preview ports saved. Changes apply immediately.",
    terminalSaved: "Remote terminal setting saved. Applies immediately.",
    previewOpen: "Preview service",
    previewPort: "Host port",
    previewLocalOnly: "Preview requires Desktop or a browser connected to Harness on this computer.",
    pluginTitle: "DeepSeek Remote",
    pluginDescription: "Connect once. Available anytime.",
    expandSettings: "Show settings: {name}",
    collapseSettings: "Hide settings: {name}",
    unsaved: "Unsaved",
    associated: "Authorized",
    authorizationComplete: "Authorization complete",
    loadingSettings: "Loading DeepSeek Remote settings\u2026",
    mode: "Mode",
    pluginMode: "Plugin mode",
    host: "Host",
    client: "Client",
    authorization: "Authorization",
    account: "Account",
    hostRegistrationCode: "One-time device authorization code",
    ownedDeviceAuthorization: "Owned device",
    authorizedOn: "{role} is authorized on {serverUrl}.",
    readOnly: "This DSH profile does not provide writable user settings.",
    discard: "Discard",
    save: "Save",
    saving: "Saving\u2026",
    signOut: "Sign out",
    signingOut: "Signing out\u2026",
    hostName: "Host name",
    deviceId: "Device ID",
    serverUrl: "Server URL",
    serverUrlHint: "HTTPS origin used for account authorization and encrypted relay.",
    serverSaved: "Server address saved. Restart DSH to apply it.",
    codexRemote: "Codex Remote",
    codexRemoteHint: "Connect to CodeX projects on this Host.",
    codexSaved: "Codex Remote setting saved. Restart DSH to apply it.",
    cursorRemote: "Cursor ACP adapter (experimental)",
    cursorRemoteHint: "Enable the Cursor `agent acp` backend for the Agent ACP gateway. Requires local `agent login`. Restart DSH after changing this setting.",
    cursorSaved: "Cursor ACP adapter setting saved. Restart DSH to apply it.",
    authorizeFromRemote: "Sign in from the Remote entry in the sidebar, then return here to manage this device.",
    authorizationMethod: "Authorization method",
    accountPassword: "Account password",
    registrationCode: "Device authorization code",
    registrationCodeHint: "Generate it after signing in on the Server website. Use it once to connect this device.",
    accountHint: "The account must belong to the selected Server.",
    password: "Password",
    passwordHint: "Used only for this HTTPS authorization request and never saved.",
    modeSavedNeedsAuthorization: "Mode saved. Authorize {role} before connecting. Existing registrations were kept.",
    modeSavedReused: "Mode saved. Existing registration reused. Restart Harness to apply.",
    modeSavedOwnedRole: "Mode saved. This owned device was authorized automatically. Restart Harness to apply.",
    enterRegistrationCode: "Enter the device authorization code.",
    enterAccountPassword: "Enter the Server account and password.",
    associationSaved: "Associated. Restart Harness to apply.",
    signedOut: "Signed out. Restart Harness to disconnect this mode.",
    remoteRequestFailed: "Remote mode request failed.",
    remoteControlUnavailable: "Remote plugin control is still starting. Restart DSH if it stays unavailable.",
    switchTarget: "Switch Local / Remote Harness target",
    harnessTarget: "Harness target",
    close: "Close",
    refreshRemote: "Refresh remote hosts",
    refreshRemoteShort: "Refresh",
    local: "Local",
    remoteTarget: "Remote \xB7 {name}",
    thisMachineLocal: "This machine (Local)",
    currentDevice: "Current device",
    noRemoteHosts: "No authorized remote Host for this account.",
    online: "Online",
    offline: "Offline",
    thisMachineHost: "This machine as Remote Host",
    connected: "Connected",
    connectedAs: "Connected as {account}",
    connection: "Connection",
    checkingConnection: "Checking connection\u2026",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    lastActive: "Last active: {time}",
    neverConnected: "No successful connection yet.",
    reconnect: "Reconnect",
    reconnectingAction: "Reconnecting\u2026",
    reconnectStarted: "Reconnect requested.",
    connectionAuthorizationExpired: "Authorization expired. Sign out and authorize this Host again.",
    connectionReplaced: "Another instance is using this Host identity. Stop it or use a separate DSH_HOME before reconnecting.",
    connectionCredentialsBusy: "Credential refresh is locked. Stop other instances. After a crash, stop all instances before removing server-credentials.json.refresh-lock and authorizing again.",
    connectionDeviceRevoked: "This Host was revoked on the Server. Sign out and authorize it again.",
    connectionOwnershipRequired: "The Server no longer recognizes this Host as an owned device.",
    connectionRateLimited: "The Server is receiving too many requests. Automatic retry will continue.",
    connectionVersionMismatch: "The Plugin and Server protocol versions are incompatible.",
    connectionInvalidResponse: "The Server returned an invalid control message.",
    connectionReachability: "Cannot reach the Server. Check the network and Server address.",
    connectionUnexpected: "The connection stopped unexpectedly. Automatic retry will continue.",
    hostSignInHint: "Sign in to authorize this Host on the selected Server.",
    checkingHost: "Checking Host registration\u2026",
    hostUnavailable: "Host unavailable: {error}",
    serverAccountEmail: "Server account email",
    serverAccountPassword: "Server account password",
    signInRegisterHost: "Sign in and register Host",
    signingIn: "Signing in\u2026",
    useRegistrationCode: "Use connection code",
    registering: "Registering\u2026",
    remoteEntry: "Remote",
    remoteTitle: "Open a remote workspace",
    remoteDescription: "Choose one of your Hosts, then select a working directory. The Harness interface stays on this device.",
    starProject: "Star us on GitHub \u2014 your support matters to this project",
    chooseHost: "Host",
    chooseDirectory: "Working directory",
    selectHostHint: "Select an online Host to browse its directories.",
    emptyDirectory: "This directory has no visible subdirectories.",
    openWorkspace: "Open workspace",
    openingWorkspace: "Opening\u2026",
    loadingDirectory: "Loading directories\u2026",
    remoteProgressCheckingHost: "Checking Host",
    remoteProgressCheckingHostDetail: "Finding the selected device and checking whether it is online.",
    remoteProgressAuthorizingPeer: "Verifying authorization",
    remoteProgressAuthorizingPeerDetail: "Confirming account membership and pinned Host identity.",
    remoteProgressOpeningChannel: "Opening encrypted channel",
    remoteProgressOpeningChannelDetail: "Trying LAN, P2P, TURN, then Relay if needed.",
    remoteProgressProbeLan: "Probing LAN",
    remoteProgressProbeLanDetail: "Checking whether the Host is reachable on the local network.",
    remoteProgressProbeP2p: "Probing P2P",
    remoteProgressProbeP2pDetail: "Checking direct internet candidates between this device and the Host.",
    remoteProgressProbeTurn: "Probing TURN",
    remoteProgressProbeTurnDetail: "Checking the TURN relay path for restricted networks.",
    remoteProgressProbeRelay: "Preparing Relay",
    remoteProgressProbeRelayDetail: "Preparing the encrypted Server Relay fallback if direct paths do not open.",
    remoteProgressTryingPrefix: "Trying ",
    remoteProgressUsingPrefix: "Using ",
    remoteProgressLoadingWorkspaces: "Loading workspaces",
    remoteProgressLoadingWorkspacesDetail: "Reading the remote Harness workspace list through the tunnel.",
    remoteProgressSwitchingWorkspace: "Switching interface",
    remoteProgressSwitchingWorkspaceDetail: "Handing the remote workspace to the local Harness UI.",
    remoteProgressReady: "Ready",
    remoteProgressReadyDetail: "The remote Host is connected and encrypted.",
    backToHosts: "Choose another Host",
    currentDirectory: "Selected directory",
    directoryTruncated: "Only part of this directory could be shown.",
    pluginVersion: "Plugin {version}",
    harnessVersion: "Harness {version}",
    existingWorkspaces: "Existing workspaces",
    remotePathPlaceholder: "/home/user/project",
    remotePathHint: "Enter an absolute directory path on the selected Host.",
    noRemoteWorkspaces: "No remote workspaces yet. Use + to add one.",
    activeRemote: "{name}",
    exitRemote: "Exit",
    addRemoteWorkspace: "Add remote workspace",
    addCodexWorkspace: "Add CodeX workspace",
    addCursorWorkspace: "Add Cursor workspace",
    addAntigravityWorkspace: "Add Antigravity workspace",
    noCodexWorkspaces: "No CodeX workspaces yet.",
    noCursorWorkspaces: "No Cursor workspaces yet. Add a project directory to start.",
    noAntigravityWorkspaces: "No Antigravity workspaces yet. Add a project directory to start.",
    cancelAddWorkspace: "Cancel",
    confirmAddWorkspace: "Add and open",
    showAllWorkspaces: "Show all DSH workspaces",
    showAllCodexWorkspaces: "Show all CodeX workspaces",
    showAllCursorWorkspaces: "Show all Cursor workspaces",
    showAllAntigravityWorkspaces: "Show all Antigravity workspaces",
    remoteModeLabel: "Remote mode \xB7 {name}",
    remoteNetworkP2p: "P2P",
    remoteNetworkTurn: "TURN",
    remoteNetworkRelay: "Relay",
    remoteNetworkLan: "LAN",
    remoteNetworkOffline: "Disconnected",
    remoteLinkEncrypted: "End-to-end encrypted",
    connectionRouteTitle: "Connection route",
    connectionRouteFrom: "From",
    connectionRouteVia: "Via",
    connectionRouteTo: "To",
    connectionRouteCurrentDevice: "This device",
    connectionRouteLan: "Local network",
    connectionRouteP2p: "Direct internet path",
    connectionRouteTurn: "TURN relay service",
    connectionRouteRelay: "Remote Server",
    connectionRouteHost: "Work computer running Harness",
    connectionRouteLanDetail: "Direct transfer over the local network",
    connectionRouteP2pDetail: "Direct transfer over the internet",
    connectionRouteTurnDetail: "Encrypted transfer through the TURN service",
    connectionRouteRelayDetail: "Encrypted transfer through the Remote Server",
    connectionRouteEncrypted: "Application data remains end-to-end encrypted along this route.",
    connectionDetailsConnection: "Connection",
    connectionDetailsWebRtc: "Network details \xB7 WebRTC / ICE",
    connectionId: "Connection ID",
    connectedAt: "Established",
    preferredTransports: "Attempt order",
    controlChannel: "Control channel",
    controlAddress: "Control address",
    controlStateConnecting: "Connecting",
    controlStateOpen: "Connected",
    controlStateClosing: "Closing",
    controlStateClosed: "Closed",
    peerState: "Peer connection",
    dataChannel: "DataChannel",
    localCandidate: "Local candidate",
    remoteCandidate: "Remote candidate",
    localAddress: "Local address",
    remoteAddress: "Remote address",
    networkProtocol: "Network protocol",
    relayProtocol: "TURN protocol",
    roundTripTime: "Round-trip time",
    availableBitrate: "Available outgoing bitrate",
    bytesSent: "WebRTC bytes sent",
    bytesReceived: "WebRTC bytes received",
    notProvided: "Not provided",
    candidateHost: "Local address \xB7 host",
    candidateSrflx: "Public address \xB7 srflx",
    candidatePrflx: "Peer address \xB7 prflx",
    candidateRelay: "TURN address \xB7 relay",
    openLocalWorkspaces: "Open local workspaces",
    clientSignInHint: "Sign in to this Server to list your remote Hosts.",
    signInClient: "DeepSeek Harness Remote",
    signInClientDescription: "Connect once. Available anytime.",
    startSignIn: "Start sign-in",
    allowControlCurrentDevice: "Allow control of this device",
    allowControlDevice: "Allow control of device",
    connectedClientCount: "{count} connected",
    checkAcp: "Check backend",
    checkingAcp: "Checking ACP\u2026",
    acpAvailable: "ACP available",
    acpUnavailable: "ACP unavailable",
    agentBackends: "More Coding Agents",
    acpDocumentation: "Read the documentation.",
    acpHint: "Connect through ACP. ",
    acpCheckPassed: "Check passed",
    acpCheckFailed: "Check failed",
    addAcp: "Add ACP",
    acpName: "Service name",
    acpCommand: "Command",
    acpArguments: "Arguments",
    removeAcp: "Remove",
    currentConnectedDevices: "Currently connected devices",
    noConnectedClients: "No devices are currently connected to this Host.",
    unknownDevice: "Unknown device",
    exitRemoteAccount: "Sign out",
    githubLogin: "GitHub QR",
    zhihuLogin: "Zhihu QR",
    scanWithGitHub: "Scan to continue with GitHub",
    scanWithZhihu: "Scan to continue with Zhihu",
    openInBrowser: "Continue in browser",
    scanLoginHint: "Authorize on your phone. This window will continue automatically.",
    currentServiceAddress: "Current service address:",
    accountPasswordLogin: "Password",
    qrLoginExpired: "This QR code expired. Refresh it to continue.",
    refreshQrCode: "Refresh QR code",
    codexVirtualWorkspace: "CodeX virtual workspace",
    cursorVirtualWorkspace: "Cursor virtual workspace",
    antigravityVirtualWorkspace: "Antigravity virtual workspace",
    codexVirtualSessions: "Sessions"
  }, zh = {
    terminalRemote: "\u8FDC\u7A0B\u7EC8\u7AEF",
    terminalRemoteHint: "\u5141\u8BB8\u53D7\u4FE1\u4EFB\u7684 Remote \u8BBE\u5907\u4EE5\u6B64 Host \u7528\u6237\u8EAB\u4EFD\u8FD0\u884C\u4EA4\u4E92\u5F0F Shell\u3002\u9ED8\u8BA4\u5F00\u542F\uFF0C\u72EC\u7ACB\u4E8E Agent \u5BA1\u6279\uFF1B\u5207\u6362\u540E\u7ACB\u5373\u4FDD\u5B58\u5E76\u751F\u6548\u3002",
    terminalRemoteUnavailable: "\u8FDC\u7A0B\u7EC8\u7AEF\u4E0D\u53EF\u7528\u3002\u8BF7\u5728 Host \u7684 Remote \u8BBE\u7F6E\u4E2D\u5F00\u542F\u300C\u8FDC\u7A0B\u7EC8\u7AEF\u300D\uFF0C\u5F00\u5173\u4F1A\u7ACB\u5373\u751F\u6548\u3002",
    previewPorts: "\u8FDC\u7A0B\u9884\u89C8\u7AEF\u53E3",
    previewPortsHint: "\u586B\u5199\u5141\u8BB8\u8BBF\u95EE\u7684 Host \u7AEF\u53E3\uFF081024\u201365535\uFF09\uFF0C\u4EE5\u9017\u53F7\u5206\u9694\u3002\u7559\u7A7A\u7981\u7528\u9884\u89C8\uFF1B\u652F\u6301 HTTP\u3001WebSocket \u548C\u70ED\u66F4\u65B0\u3002",
    developmentSave: "\u4FDD\u5B58\u8BBF\u95EE\u8BBE\u7F6E",
    developmentSaved: "\u8FDC\u7A0B\u9884\u89C8\u7AEF\u53E3\u5DF2\u4FDD\u5B58\uFF0C\u7ACB\u5373\u751F\u6548\u3002",
    terminalSaved: "\u8FDC\u7A0B\u7EC8\u7AEF\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u7ACB\u5373\u751F\u6548\u3002",
    previewOpen: "\u9884\u89C8\u670D\u52A1",
    previewPort: "Host \u7AEF\u53E3",
    previewLocalOnly: "\u9884\u89C8\u9700\u8981 Desktop\uFF0C\u6216\u8FDE\u63A5\u5230\u672C\u673A Harness \u7684\u6D4F\u89C8\u5668\u3002",
    pluginTitle: "DeepSeek \u8FDC\u7A0B\u8FDE\u63A5",
    pluginDescription: "\u4E00\u6B21\u8FDE\u63A5\uFF0C\u968F\u65F6\u53EF\u7528\u3002",
    expandSettings: "\u5C55\u5F00\u8BBE\u7F6E\uFF1A{name}",
    collapseSettings: "\u6536\u8D77\u8BBE\u7F6E\uFF1A{name}",
    unsaved: "\u672A\u4FDD\u5B58",
    associated: "\u5DF2\u6388\u6743",
    authorizationComplete: "\u5DF2\u5B8C\u6210\u6388\u6743",
    loadingSettings: "\u6B63\u5728\u52A0\u8F7D DeepSeek \u8FDC\u7A0B\u8FDE\u63A5\u8BBE\u7F6E\u2026",
    mode: "\u6A21\u5F0F",
    pluginMode: "\u63D2\u4EF6\u6A21\u5F0F",
    host: "\u4E3B\u673A",
    client: "Client",
    authorization: "\u6388\u6743",
    account: "\u8D26\u53F7",
    hostRegistrationCode: "\u4E00\u6B21\u6027\u8BBE\u5907\u6388\u6743\u7801",
    ownedDeviceAuthorization: "\u81EA\u6709\u8BBE\u5907",
    authorizedOn: "{role}\u5DF2\u7ECF\u5728 {serverUrl} \u5B8C\u6210\u6388\u6743\u3002",
    readOnly: "\u6B64 DSH profile \u4E0D\u63D0\u4F9B\u53EF\u5199\u7684\u7528\u6237\u8BBE\u7F6E\u3002",
    discard: "\u653E\u5F03\u4FEE\u6539",
    save: "\u4FDD\u5B58",
    saving: "\u4FDD\u5B58\u4E2D\u2026",
    signOut: "\u9000\u51FA\u6388\u6743",
    signingOut: "\u6B63\u5728\u9000\u51FA\u2026",
    hostName: "\u4E3B\u673A\u540D\u79F0",
    deviceId: "\u8BBE\u5907 ID",
    serverUrl: "Server \u5730\u5740",
    serverUrlHint: "\u7528\u4E8E\u8D26\u53F7\u6388\u6743\u548C\u52A0\u5BC6\u4E2D\u7EE7\u7684 HTTPS \u5730\u5740\u3002",
    serverSaved: "Server \u5730\u5740\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002",
    codexRemote: "Codex Remote",
    codexRemoteHint: "\u8FDE\u63A5\u8FD9\u53F0 Host \u4E0A\u7684 CodeX \u9879\u76EE\u3002",
    codexSaved: "Codex Remote \u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002",
    cursorRemote: "Cursor ACP adapter\uFF08\u5B9E\u9A8C\u6027\uFF09",
    cursorRemoteHint: "\u4E3A Agent ACP gateway \u542F\u7528 Cursor `agent acp` backend\u3002\u9700\u672C\u673A\u5B8C\u6210 `agent login`\u3002\u4FEE\u6539\u540E\u9700\u91CD\u542F DSH \u751F\u6548\u3002",
    cursorSaved: "Cursor ACP adapter \u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002",
    authorizeFromRemote: "\u8BF7\u4ECE\u4FA7\u680F Remote \u5165\u53E3\u767B\u5F55\uFF0C\u767B\u5F55\u540E\u53EF\u5728\u8FD9\u91CC\u7BA1\u7406\u5F53\u524D\u8BBE\u5907\u3002",
    authorizationMethod: "\u6388\u6743\u65B9\u5F0F",
    accountPassword: "\u8D26\u53F7\u5BC6\u7801",
    registrationCode: "\u8BBE\u5907\u6388\u6743\u7801",
    registrationCodeHint: "\u767B\u5F55 Server \u7F51\u9875\u540E\u751F\u6210\uFF0C\u7528\u4E00\u6B21\u5373\u53EF\u8FDE\u63A5\u8FD9\u53F0\u8BBE\u5907\u3002",
    accountHint: "\u8D26\u53F7\u5FC5\u987B\u5C5E\u4E8E\u6240\u9009 Server\u3002",
    password: "\u5BC6\u7801",
    passwordHint: "\u4EC5\u7528\u4E8E\u672C\u6B21 HTTPS \u6388\u6743\u8BF7\u6C42\uFF0C\u4E0D\u4F1A\u4FDD\u5B58\u3002",
    modeSavedNeedsAuthorization: "\u6A21\u5F0F\u5DF2\u4FDD\u5B58\u3002\u8FDE\u63A5\u524D\u8BF7\u5148\u6388\u6743 {role}\uFF1B\u5DF2\u6709\u6CE8\u518C\u4FE1\u606F\u5DF2\u4FDD\u7559\u3002",
    modeSavedReused: "\u6A21\u5F0F\u5DF2\u4FDD\u5B58\u5E76\u590D\u7528\u5DF2\u6709\u6CE8\u518C\u4FE1\u606F\u3002\u91CD\u542F Harness \u540E\u751F\u6548\u3002",
    modeSavedOwnedRole: "\u6A21\u5F0F\u5DF2\u4FDD\u5B58\uFF0C\u5E76\u5DF2\u81EA\u52A8\u6388\u6743\u6B64\u81EA\u6709\u8BBE\u5907\u3002\u91CD\u542F Harness \u540E\u751F\u6548\u3002",
    enterRegistrationCode: "\u8BF7\u8F93\u5165\u8BBE\u5907\u6388\u6743\u7801\u3002",
    enterAccountPassword: "\u8BF7\u8F93\u5165 Server \u8D26\u53F7\u548C\u5BC6\u7801\u3002",
    associationSaved: "\u5173\u8054\u6210\u529F\u3002\u91CD\u542F Harness \u540E\u751F\u6548\u3002",
    signedOut: "\u5DF2\u9000\u51FA\u6388\u6743\u3002\u91CD\u542F Harness \u540E\u5C06\u65AD\u5F00\u6B64\u6A21\u5F0F\u3002",
    remoteRequestFailed: "\u8FDC\u7A0B\u6A21\u5F0F\u8BF7\u6C42\u5931\u8D25\u3002",
    remoteControlUnavailable: "Remote \u63D2\u4EF6\u63A7\u5236\u901A\u9053\u4ECD\u5728\u542F\u52A8\uFF1B\u5982\u679C\u4E00\u76F4\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u542F DSH\u3002",
    switchTarget: "\u5207\u6362\u672C\u5730\u6216\u8FDC\u7A0B Harness",
    harnessTarget: "Harness \u76EE\u6807",
    close: "\u5173\u95ED",
    refreshRemote: "\u5237\u65B0\u8FDC\u7A0B\u4E3B\u673A",
    refreshRemoteShort: "\u5237\u65B0",
    local: "\u672C\u5730",
    remoteTarget: "\u8FDC\u7A0B \xB7 {name}",
    thisMachineLocal: "\u6B64\u8BBE\u5907\uFF08\u672C\u5730\uFF09",
    currentDevice: "\u5F53\u524D\u8BBE\u5907",
    noRemoteHosts: "\u6B64\u8D26\u53F7\u6CA1\u6709\u5DF2\u6388\u6743\u7684\u8FDC\u7A0B Host\u3002",
    online: "\u5728\u7EBF",
    offline: "\u79BB\u7EBF",
    thisMachineHost: "\u5C06\u6B64\u8BBE\u5907\u4F5C\u4E3A\u8FDC\u7A0B Host",
    connected: "\u5DF2\u8FDE\u63A5",
    connectedAs: "\u5DF2\u4F7F\u7528 {account} \u8FDE\u63A5",
    connection: "\u8FDE\u63A5\u72B6\u6001",
    checkingConnection: "\u6B63\u5728\u68C0\u67E5\u8FDE\u63A5\u2026",
    connecting: "\u6B63\u5728\u8FDE\u63A5",
    reconnecting: "\u6B63\u5728\u91CD\u8FDE",
    lastActive: "\u6700\u540E\u6D3B\u8DC3\uFF1A{time}",
    neverConnected: "\u5C1A\u672A\u6210\u529F\u8FDE\u63A5\u8FC7\u3002",
    reconnect: "\u624B\u52A8\u91CD\u8FDE",
    reconnectingAction: "\u6B63\u5728\u91CD\u8FDE\u2026",
    reconnectStarted: "\u5DF2\u53D1\u8D77\u91CD\u8FDE\u3002",
    connectionAuthorizationExpired: "\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u8BF7\u9000\u51FA\u6388\u6743\u540E\u91CD\u65B0\u8FDE\u63A5\u6B64 Host\u3002",
    connectionReplaced: "\u53E6\u4E00\u5B9E\u4F8B\u6B63\u5728\u4F7F\u7528\u6B64 Host \u8EAB\u4EFD\u3002\u8BF7\u505C\u6B62\u8BE5\u5B9E\u4F8B\uFF0C\u6216\u4F7F\u7528\u72EC\u7ACB\u7684 DSH_HOME \u540E\u91CD\u65B0\u8FDE\u63A5\u3002",
    connectionCredentialsBusy: "\u51ED\u636E\u5237\u65B0\u88AB\u9501\u5B9A\uFF0C\u8BF7\u505C\u6B62\u5176\u4ED6\u5B9E\u4F8B\u3002\u82E5\u6B64\u524D\u5F02\u5E38\u9000\u51FA\uFF0C\u8BF7\u505C\u6B62\u6240\u6709\u5B9E\u4F8B\u540E\u79FB\u9664 server-credentials.json.refresh-lock \u5E76\u91CD\u65B0\u6388\u6743\u3002",
    connectionDeviceRevoked: "\u6B64 Host \u5DF2\u5728 Server \u4E0A\u88AB\u64A4\u9500\uFF0C\u8BF7\u9000\u51FA\u6388\u6743\u540E\u91CD\u65B0\u8FDE\u63A5\u3002",
    connectionOwnershipRequired: "Server \u5DF2\u4E0D\u518D\u5C06\u6B64 Host \u8BC6\u522B\u4E3A\u5F53\u524D\u8D26\u53F7\u7684\u8BBE\u5907\u3002",
    connectionRateLimited: "Server \u8BF7\u6C42\u8FC7\u591A\uFF0C\u63D2\u4EF6\u5C06\u7EE7\u7EED\u81EA\u52A8\u91CD\u8BD5\u3002",
    connectionVersionMismatch: "Plugin \u4E0E Server \u7684\u534F\u8BAE\u7248\u672C\u4E0D\u517C\u5BB9\u3002",
    connectionInvalidResponse: "Server \u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u63A7\u5236\u6D88\u606F\u3002",
    connectionReachability: "\u65E0\u6CD5\u8FDE\u63A5 Server\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u548C Server \u5730\u5740\u3002",
    connectionUnexpected: "\u8FDE\u63A5\u610F\u5916\u4E2D\u65AD\uFF0C\u63D2\u4EF6\u5C06\u7EE7\u7EED\u81EA\u52A8\u91CD\u8BD5\u3002",
    hostSignInHint: "\u767B\u5F55\u540E\u5728\u6240\u9009 Server \u4E0A\u6388\u6743\u6B64 Host\u3002",
    checkingHost: "\u6B63\u5728\u68C0\u67E5 Host \u6CE8\u518C\u72B6\u6001\u2026",
    hostUnavailable: "Host \u4E0D\u53EF\u7528\uFF1A{error}",
    serverAccountEmail: "Server \u8D26\u53F7\u90AE\u7BB1",
    serverAccountPassword: "Server \u8D26\u53F7\u5BC6\u7801",
    signInRegisterHost: "\u767B\u5F55\u5E76\u6CE8\u518C Host",
    signingIn: "\u6B63\u5728\u767B\u5F55\u2026",
    useRegistrationCode: "\u4F7F\u7528\u8FDE\u63A5\u7801",
    registering: "\u6B63\u5728\u6CE8\u518C\u2026",
    remoteEntry: "Remote",
    remoteTitle: "\u6253\u5F00\u8FDC\u7AEF\u5DE5\u4F5C\u533A",
    remoteDescription: "\u9009\u62E9\u60F3\u8981\u8FDE\u63A5\u4E3B\u673A\u548C\u5DE5\u4F5C\u76EE\u5F55\u3002",
    starProject: "\u6B22\u8FCE\u70B9\u4E2A Star\uFF0C\u4F60\u7684\u652F\u6301\u5BF9\u9879\u76EE\u5F88\u91CD\u8981",
    chooseHost: "\u4E3B\u673A",
    chooseDirectory: "\u5DE5\u4F5C\u76EE\u5F55",
    selectHostHint: "\u9009\u62E9\u4E00\u53F0\u5728\u7EBF\u4E3B\u673A\u4EE5\u6D4F\u89C8\u5176\u76EE\u5F55\u3002",
    emptyDirectory: "\u8FD9\u4E2A\u76EE\u5F55\u4E0B\u6CA1\u6709\u53EF\u89C1\u7684\u5B50\u76EE\u5F55\u3002",
    openWorkspace: "\u6253\u5F00\u5DE5\u4F5C\u533A",
    openingWorkspace: "\u6B63\u5728\u6253\u5F00\u2026",
    loadingDirectory: "\u6B63\u5728\u52A0\u8F7D\u76EE\u5F55\u2026",
    remoteProgressCheckingHost: "\u6B63\u5728\u68C0\u67E5 Host",
    remoteProgressCheckingHostDetail: "\u6B63\u5728\u67E5\u627E\u6240\u9009\u8BBE\u5907\u5E76\u786E\u8BA4\u662F\u5426\u5728\u7EBF\u3002",
    remoteProgressAuthorizingPeer: "\u6B63\u5728\u9A8C\u8BC1\u6388\u6743",
    remoteProgressAuthorizingPeerDetail: "\u6B63\u5728\u786E\u8BA4\u8D26\u53F7\u6210\u5458\u5173\u7CFB\u548C\u5DF2\u56FA\u5B9A\u7684 Host \u8EAB\u4EFD\u3002",
    remoteProgressOpeningChannel: "\u6B63\u5728\u5EFA\u7ACB\u52A0\u5BC6\u901A\u9053",
    remoteProgressOpeningChannelDetail: "\u4F9D\u6B21\u5C1D\u8BD5\u5C40\u57DF\u7F51\u3001P2P\u3001TURN\uFF0C\u5FC5\u8981\u65F6\u56DE\u843D\u5230 Relay\u3002",
    remoteProgressProbeLan: "\u6B63\u5728\u63A2\u6D4B\u5C40\u57DF\u7F51",
    remoteProgressProbeLanDetail: "\u68C0\u67E5\u5F53\u524D\u8BBE\u5907\u662F\u5426\u80FD\u901A\u8FC7\u672C\u5730\u7F51\u7EDC\u76F4\u8FDE Host\u3002",
    remoteProgressProbeP2p: "\u6B63\u5728\u63A2\u6D4B P2P",
    remoteProgressProbeP2pDetail: "\u68C0\u67E5\u5F53\u524D\u8BBE\u5907\u548C Host \u4E4B\u95F4\u7684\u4E92\u8054\u7F51\u76F4\u8FDE\u5019\u9009\u8DEF\u5F84\u3002",
    remoteProgressProbeTurn: "\u6B63\u5728\u63A2\u6D4B TURN",
    remoteProgressProbeTurnDetail: "\u68C0\u67E5\u53D7\u9650\u7F51\u7EDC\u4E0B\u53EF\u7528\u7684 TURN \u4E2D\u7EE7\u8DEF\u5F84\u3002",
    remoteProgressProbeRelay: "\u6B63\u5728\u51C6\u5907 Relay",
    remoteProgressProbeRelayDetail: "\u5982\u679C\u76F4\u8FDE\u8DEF\u5F84\u672A\u6253\u5F00\uFF0C\u5C06\u56DE\u843D\u5230\u52A0\u5BC6\u7684 Server Relay\u3002",
    remoteProgressTryingPrefix: "\u6B63\u5728\u5C1D\u8BD5 ",
    remoteProgressUsingPrefix: "\u5DF2\u8FDE\u63A5 ",
    remoteProgressLoadingWorkspaces: "\u6B63\u5728\u52A0\u8F7D\u5DE5\u4F5C\u533A",
    remoteProgressLoadingWorkspacesDetail: "\u901A\u8FC7\u96A7\u9053\u8BFB\u53D6\u8FDC\u7AEF Harness \u5DE5\u4F5C\u533A\u5217\u8868\u3002",
    remoteProgressSwitchingWorkspace: "\u6B63\u5728\u5207\u6362\u754C\u9762",
    remoteProgressSwitchingWorkspaceDetail: "\u6B63\u5728\u628A\u8FDC\u7AEF\u5DE5\u4F5C\u533A\u4EA4\u7ED9\u672C\u5730 Harness UI\u3002",
    remoteProgressReady: "\u5DF2\u5C31\u7EEA",
    remoteProgressReadyDetail: "\u8FDC\u7AEF Host \u5DF2\u8FDE\u63A5\uFF0C\u7AEF\u5230\u7AEF\u52A0\u5BC6\u5DF2\u5EFA\u7ACB\u3002",
    backToHosts: "\u9009\u62E9\u5176\u4ED6\u4E3B\u673A",
    currentDirectory: "\u5DF2\u9009\u76EE\u5F55",
    directoryTruncated: "\u76EE\u5F55\u5185\u5BB9\u8F83\u591A\uFF0C\u76EE\u524D\u53EA\u663E\u793A\u4E86\u4E00\u90E8\u5206\u3002",
    pluginVersion: "\u63D2\u4EF6 {version}",
    harnessVersion: "Harness {version}",
    existingWorkspaces: "\u5DF2\u6709\u5DE5\u4F5C\u533A",
    remotePathPlaceholder: "/home/user/project",
    remotePathHint: "\u8F93\u5165\u6240\u9009\u4E3B\u673A\u4E0A\u7684\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002",
    noRemoteWorkspaces: "\u8FD9\u53F0\u4E3B\u673A\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A\uFF0C\u70B9\u51FB + \u6DFB\u52A0\u3002",
    activeRemote: "{name}",
    exitRemote: "\u9000\u51FA",
    addRemoteWorkspace: "\u6DFB\u52A0\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
    addCodexWorkspace: "\u6DFB\u52A0 CodeX \u5DE5\u4F5C\u533A",
    addCursorWorkspace: "\u6DFB\u52A0 Cursor \u5DE5\u4F5C\u533A",
    addAntigravityWorkspace: "\u6DFB\u52A0 Antigravity \u5DE5\u4F5C\u533A",
    noCodexWorkspaces: "\u8FD8\u6CA1\u6709 CodeX \u5DE5\u4F5C\u533A\u3002",
    noCursorWorkspaces: "\u8FD8\u6CA1\u6709 Cursor \u5DE5\u4F5C\u533A\u3002\u6DFB\u52A0\u9879\u76EE\u76EE\u5F55\u5373\u53EF\u5F00\u59CB\u3002",
    noAntigravityWorkspaces: "\u8FD8\u6CA1\u6709 Antigravity \u5DE5\u4F5C\u533A\u3002\u6DFB\u52A0\u9879\u76EE\u76EE\u5F55\u5373\u53EF\u5F00\u59CB\u3002",
    cancelAddWorkspace: "\u53D6\u6D88",
    confirmAddWorkspace: "\u786E\u8BA4\u5E76\u6253\u5F00",
    showAllWorkspaces: "\u663E\u793A\u5168\u90E8 DSH \u5DE5\u4F5C\u533A",
    showAllCodexWorkspaces: "\u663E\u793A\u5168\u90E8 CodeX \u5DE5\u4F5C\u533A",
    showAllCursorWorkspaces: "\u663E\u793A\u5168\u90E8 Cursor \u5DE5\u4F5C\u533A",
    showAllAntigravityWorkspaces: "\u663E\u793A\u5168\u90E8 Antigravity \u5DE5\u4F5C\u533A",
    remoteModeLabel: "\u8FDC\u7A0B\u6A21\u5F0F \xB7 {name}",
    remoteNetworkP2p: "P2P",
    remoteNetworkTurn: "TURN",
    remoteNetworkRelay: "\u4E2D\u7EE7",
    remoteNetworkLan: "\u5C40\u57DF\u7F51",
    remoteNetworkOffline: "\u5DF2\u65AD\u5F00",
    remoteLinkEncrypted: "\u7AEF\u5230\u7AEF\u52A0\u5BC6",
    connectionRouteTitle: "\u8FDE\u63A5\u7EBF\u8DEF",
    connectionRouteFrom: "\u8D77\u70B9",
    connectionRouteVia: "\u7ECF\u8FC7",
    connectionRouteTo: "\u7EC8\u70B9",
    connectionRouteCurrentDevice: "\u5F53\u524D\u8BBE\u5907",
    connectionRouteLan: "\u540C\u4E00\u5C40\u57DF\u7F51",
    connectionRouteP2p: "\u4E92\u8054\u7F51\u76F4\u8FDE",
    connectionRouteTurn: "TURN \u4E2D\u7EE7\u670D\u52A1",
    connectionRouteRelay: "Remote Server",
    connectionRouteHost: "\u8FD0\u884C Harness \u7684\u5DE5\u4F5C\u7535\u8111",
    connectionRouteLanDetail: "\u5728\u672C\u5730\u7F51\u7EDC\u4E2D\u76F4\u63A5\u4F20\u8F93",
    connectionRouteP2pDetail: "\u901A\u8FC7\u4E92\u8054\u7F51\u76F4\u63A5\u4F20\u8F93",
    connectionRouteTurnDetail: "\u901A\u8FC7 TURN \u670D\u52A1\u8F6C\u53D1\u52A0\u5BC6\u6570\u636E",
    connectionRouteRelayDetail: "\u901A\u8FC7 Remote Server \u8F6C\u53D1\u52A0\u5BC6\u6570\u636E",
    connectionRouteEncrypted: "\u7EBF\u8DEF\u4E0A\u7684\u4E1A\u52A1\u6570\u636E\u4FDD\u6301\u7AEF\u5230\u7AEF\u52A0\u5BC6\u3002",
    connectionDetailsConnection: "\u8FDE\u63A5",
    connectionDetailsWebRtc: "\u7F51\u7EDC\u8BE6\u60C5 \xB7 WebRTC / ICE",
    connectionId: "\u8FDE\u63A5\u7F16\u53F7",
    connectedAt: "\u5EFA\u7ACB\u65F6\u95F4",
    preferredTransports: "\u5C1D\u8BD5\u987A\u5E8F",
    controlChannel: "\u63A7\u5236\u901A\u9053",
    controlAddress: "\u63A7\u5236\u5730\u5740",
    controlStateConnecting: "\u8FDE\u63A5\u4E2D",
    controlStateOpen: "\u5DF2\u8FDE\u63A5",
    controlStateClosing: "\u6B63\u5728\u5173\u95ED",
    controlStateClosed: "\u5DF2\u5173\u95ED",
    peerState: "\u8FDE\u63A5\u72B6\u6001",
    dataChannel: "DataChannel",
    localCandidate: "\u672C\u5730\u5019\u9009",
    remoteCandidate: "\u8FDC\u7AEF\u5019\u9009",
    localAddress: "\u672C\u5730\u5730\u5740",
    remoteAddress: "\u8FDC\u7AEF\u5730\u5740",
    networkProtocol: "\u4F20\u8F93\u534F\u8BAE",
    relayProtocol: "TURN \u534F\u8BAE",
    roundTripTime: "\u5F80\u8FD4\u65F6\u5EF6",
    availableBitrate: "\u53EF\u7528\u4E0A\u884C\u5E26\u5BBD",
    bytesSent: "WebRTC \u5DF2\u53D1\u9001",
    bytesReceived: "WebRTC \u5DF2\u63A5\u6536",
    notProvided: "\u672A\u63D0\u4F9B",
    candidateHost: "\u672C\u5730\u5730\u5740 \xB7 host",
    candidateSrflx: "\u516C\u7F51\u5730\u5740 \xB7 srflx",
    candidatePrflx: "\u5BF9\u7AEF\u5730\u5740 \xB7 prflx",
    candidateRelay: "TURN \u5730\u5740 \xB7 relay",
    openLocalWorkspaces: "\u6253\u5F00\u672C\u5730\u5DE5\u4F5C\u533A",
    clientSignInHint: "\u767B\u5F55 Server \u540E\u5373\u53EF\u67E5\u770B\u81EA\u5DF1\u7684\u8FDC\u7AEF\u4E3B\u673A\u3002",
    signInClient: "DeepSeek Harness Remote",
    signInClientDescription: "\u4E00\u6B21\u8FDE\u63A5\uFF0C\u968F\u65F6\u53EF\u7528\u3002",
    startSignIn: "\u5F00\u59CB\u767B\u5F55",
    allowControlCurrentDevice: "\u5141\u8BB8\u63A7\u5236\u5F53\u524D\u8BBE\u5907",
    allowControlDevice: "\u5141\u8BB8\u63A7\u5236\u8BBE\u5907",
    connectedClientCount: "{count} \u53F0\u5DF2\u8FDE\u63A5",
    checkAcp: "\u68C0\u6D4B\u540E\u7AEF",
    checkingAcp: "\u6B63\u5728\u68C0\u6D4B ACP\u2026",
    acpAvailable: "ACP \u53EF\u7528",
    acpUnavailable: "ACP \u4E0D\u53EF\u7528",
    agentBackends: "\u66F4\u591A Coding Agent",
    acpDocumentation: "\u8BE6\u7EC6\u8BF7\u67E5\u9605\u3002",
    acpHint: "\u901A\u8FC7 ACP \u7EDF\u4E00\u63A5\u5165\uFF0C",
    acpCheckPassed: "\u68C0\u6D4B\u901A\u8FC7",
    acpCheckFailed: "\u68C0\u6D4B\u5931\u8D25",
    addAcp: "\u6DFB\u52A0 ACP",
    acpName: "\u670D\u52A1\u540D\u79F0",
    acpCommand: "\u542F\u52A8\u547D\u4EE4",
    acpArguments: "\u547D\u4EE4\u53C2\u6570",
    removeAcp: "\u79FB\u9664",
    currentConnectedDevices: "\u5F53\u524D\u8FDE\u63A5\u7684\u8BBE\u5907",
    noConnectedClients: "\u76EE\u524D\u6CA1\u6709\u8BBE\u5907\u8FDE\u63A5\u5230\u8FD9\u53F0\u4E3B\u673A\u3002",
    unknownDevice: "\u672A\u77E5\u8BBE\u5907",
    exitRemoteAccount: "\u9000\u51FA\u8D26\u53F7",
    githubLogin: "GitHub \u626B\u7801",
    zhihuLogin: "\u77E5\u4E4E\u626B\u7801",
    scanWithGitHub: "\u4F7F\u7528 GitHub \u626B\u7801\u767B\u5F55",
    scanWithZhihu: "\u4F7F\u7528\u77E5\u4E4E\u626B\u7801\u767B\u5F55",
    openInBrowser: "\u5728\u6D4F\u89C8\u5668\u4E2D\u7EE7\u7EED",
    scanLoginHint: "\u8BF7\u5728\u624B\u673A\u4E0A\u5B8C\u6210\u6388\u6743\uFF0C\u6B64\u7A97\u53E3\u4F1A\u81EA\u52A8\u7EE7\u7EED\u3002",
    currentServiceAddress: "\u5F53\u524D\u670D\u52A1\u5730\u5740\uFF1A",
    accountPasswordLogin: "\u8D26\u53F7\u5BC6\u7801",
    qrLoginExpired: "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
    refreshQrCode: "\u5237\u65B0\u4E8C\u7EF4\u7801",
    codexVirtualWorkspace: "CodeX \u5DE5\u4F5C\u533A",
    cursorVirtualWorkspace: "Cursor \u5DE5\u4F5C\u533A",
    antigravityVirtualWorkspace: "Antigravity \u5DE5\u4F5C\u533A",
    codexVirtualSessions: "Sessions"
  }, defaultPreferredTransports = ["lan", "p2p", "turn", "relay"], controlRouteBackoffStepsMs = [1e3, 2e3, 5e3, 1e4, 3e4], ControlRouteUnavailableError = class extends Error {
    constructor(message) {
      super(message), this.name = "ControlRouteUnavailableError";
    }
  };
  function controlRouteUnavailableStatus() {
    return {
      mode: "local",
      available: !1,
      controlUnavailable: !0,
      connected: !1,
      transport: "Disconnected",
      remoteFeatures: { commandList: !1, fileViewer: !1, terminal: !1, codex: !1, cursor: !1, antigravity: !1 },
      hostAuthorizationAvailable: !1
    };
  }
  function normalizedPreferredTransports(value) {
    return value === void 0 || value.length === 0 ? [...defaultPreferredTransports] : [...value];
  }
  function formatLocalTime(value) {
    let date = new Date(value);
    return Number.isNaN(date.getTime()) ? "\u2014" : date.toLocaleString();
  }
  function formatByteSize(value) {
    if (value < 1024) return `${value.toLocaleString()} B`;
    let units = ["KiB", "MiB", "GiB"], amount = value, unit = "B";
    for (let nextUnit of units)
      if (amount /= 1024, unit = nextUnit, amount < 1024) break;
    return `${amount.toLocaleString(void 0, { maximumFractionDigits: 1 })} ${unit}`;
  }
  function formatBitrate(value) {
    let units = ["bit/s", "Kbit/s", "Mbit/s", "Gbit/s"], amount = value, unitIndex = 0;
    for (; amount >= 1e3 && unitIndex < units.length - 1; )
      amount /= 1e3, unitIndex += 1;
    return `${amount.toLocaleString(void 0, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
  }
  function shortDeviceId(value) {
    return value.length <= 14 ? value : `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
  }
  function transportLabel(value, t) {
    return t(value === "lan" ? "remoteNetworkLan" : value === "p2p" ? "remoteNetworkP2p" : value === "turn" ? "remoteNetworkTurn" : "remoteNetworkRelay");
  }
  function transportDiagnosticLabel(value) {
    return value === "lan" ? "LAN" : value === "p2p" ? "P2P" : value === "turn" ? "TURN" : "Relay";
  }
  function transportProgressCopy(value) {
    return value === "lan" ? { label: "remoteProgressProbeLan", detail: "remoteProgressProbeLanDetail" } : value === "p2p" ? { label: "remoteProgressProbeP2p", detail: "remoteProgressProbeP2pDetail" } : value === "turn" ? { label: "remoteProgressProbeTurn", detail: "remoteProgressProbeTurnDetail" } : { label: "remoteProgressProbeRelay", detail: "remoteProgressProbeRelayDetail" };
  }
  function statusTransportPreference(status) {
    if (status?.transport === "LAN") return "lan";
    if (status?.transport === "P2P") return "p2p";
    if (status?.transport === "TURN") return "turn";
    if (status?.transport === "Relay") return "relay";
  }
  function connectedProgress(status) {
    let activeTransport = statusTransportPreference(status);
    if (activeTransport !== void 0)
      return {
        label: "remoteProgressReady",
        detail: "remoteProgressReadyDetail",
        percent: 100,
        transports: normalizedPreferredTransports(status?.preferredTransports),
        activeTransports: [activeTransport],
        routeVerb: "using"
      };
  }
  function loadingProgressPercent(elapsedMs) {
    return elapsedMs >= 6800 ? 96 : elapsedMs >= 3800 ? 93 : elapsedMs >= 1600 ? 89 : 84;
  }
  function observedConnectionProgress(status, targetDeviceId, preferredTransports, connectedStep, connectedAt) {
    let transports = normalizedPreferredTransports(status.preferredTransports ?? preferredTransports), connection = status.connectionProgress;
    if (connection?.targetDeviceId === targetDeviceId) {
      if (connection.phase === "checking-host")
        return { label: "remoteProgressCheckingHost", detail: "remoteProgressCheckingHostDetail", percent: 12 };
      if (connection.phase === "authorizing-peer")
        return { label: "remoteProgressAuthorizingPeer", detail: "remoteProgressAuthorizingPeerDetail", percent: 30 };
      let activeTransports = connection.activeTransports?.filter((transport) => transports.includes(transport)) ?? [];
      if (connection.phase === "probing") {
        let activeIndex = Math.max(0, ...activeTransports.map((transport) => transports.indexOf(transport)));
        return {
          ...activeTransports.length === 1 ? transportProgressCopy(activeTransports[0]) : { label: "remoteProgressOpeningChannel", detail: "remoteProgressOpeningChannelDetail" },
          percent: Math.min(76, 42 + activeIndex * 10),
          transports,
          activeTransports,
          routeVerb: "trying"
        };
      }
      return {
        ...connectedStep,
        percent: loadingProgressPercent(connectedAt === void 0 ? 0 : Date.now() - connectedAt),
        transports,
        activeTransports,
        routeVerb: "using"
      };
    }
    if (status.connectedTargetDeviceId !== targetDeviceId) return;
    let activeTransport = statusTransportPreference(status);
    return {
      ...connectedStep,
      percent: loadingProgressPercent(connectedAt === void 0 ? 0 : Date.now() - connectedAt),
      transports,
      ...activeTransport === void 0 ? {} : { activeTransports: [activeTransport], routeVerb: "using" }
    };
  }
  function connectionErrorMessage(code, t) {
    return t(code === "ACCOUNT_AUTH_REQUIRED" || code === "AUTH_INVALID" || code === "TOKEN_EXPIRED" ? "connectionAuthorizationExpired" : code === "CONNECTION_REPLACED" ? "connectionReplaced" : code === "SERVER_CREDENTIALS_BUSY" ? "connectionCredentialsBusy" : code === "DEVICE_REVOKED" ? "connectionDeviceRevoked" : code === "DEVICE_OWNERSHIP_REQUIRED" ? "connectionOwnershipRequired" : code === "RATE_LIMITED" ? "connectionRateLimited" : code === "UNSUPPORTED_VERSION" ? "connectionVersionMismatch" : code === "INVALID_MESSAGE" ? "connectionInvalidResponse" : code === "CONNECTION_FAILED" || code === "SERVER_NOT_CONFIGURED" ? "connectionReachability" : "connectionUnexpected");
  }
  function connectionStatusLabel(status, t) {
    return status === void 0 ? t("checkingConnection") : status.online ? t("online") : status.reconnecting ? t(status.lastActiveAt === void 0 && status.error === void 0 ? "connecting" : "reconnecting") : t("offline");
  }
  function connectionStatusClass(status) {
    return status?.online ? " isOnline" : status?.reconnecting ? " isReconnecting" : status === void 0 ? "" : " isOffline";
  }
  window.__ModuleLoader__.load({
    id: clientModuleId,
    factory: (require2) => {
      let module = { exports: {} }, React = require2("react"), inject = [
        "connection",
        "slots",
        "locale",
        "workspaces",
        "sessions"
      ];
      function RemoteProgressView(props) {
        let progress = props.progress;
        if (progress === void 0) return null;
        let percent = Math.max(0, Math.min(100, Math.round(progress.percent))), activeTransports = new Set(progress.activeTransports ?? []), detail = progress.transports !== void 0 && activeTransports.size > 0 ? React.createElement(
          "span",
          { className: "dshRemoteProgressRoute" },
          props.t(progress.routeVerb === "using" ? "remoteProgressUsingPrefix" : "remoteProgressTryingPrefix"),
          progress.transports.map((transport, index) => React.createElement(
            React.Fragment,
            { key: `${transport}:${index}` },
            index === 0 ? null : React.createElement("span", { className: "dshRemoteProgressRouteArrow", "aria-hidden": !0 }, " -> "),
            React.createElement("span", {
              className: activeTransports.has(transport) ? "isActive" : void 0
            }, transportDiagnosticLabel(transport))
          ))
        ) : props.t(progress.detail);
        return React.createElement(
          "div",
          {
            className: "dshRemoteProgress",
            role: "status",
            "aria-live": "polite"
          },
          React.createElement(
            "div",
            { className: "dshRemoteProgressHeader" },
            React.createElement("strong", null, props.t(progress.label)),
            React.createElement("span", null, `${percent}%`)
          ),
          React.createElement("p", null, detail),
          React.createElement("div", {
            className: "dshRemoteProgressBar",
            role: "progressbar",
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": percent,
            "aria-label": props.t(progress.label)
          }, React.createElement("span", { style: { transform: `scaleX(${percent / 100})` } }))
        );
      }
      async function runConnectHostProgress(preferredTransports, targetDeviceId, control, connectedStep, setProgress, progressRun, action, readyProgress) {
        let runId = progressRun.current + 1;
        progressRun.current = runId;
        let polling = !0, pollTimer, connectedAt, apply2 = (next) => {
          progressRun.current === runId && setProgress(next);
        }, poll = async () => {
          try {
            let status = await control("status");
            if (!polling || progressRun.current !== runId) return;
            (status.connectionProgress?.phase === "connected" || status.connectedTargetDeviceId === targetDeviceId) && connectedAt === void 0 && (connectedAt = Date.now());
            let next = observedConnectionProgress(status, targetDeviceId, preferredTransports, connectedStep, connectedAt);
            next !== void 0 && apply2(next);
          } catch {
          } finally {
            polling && progressRun.current === runId && (pollTimer = window.setTimeout(() => {
              poll();
            }, 300));
          }
        };
        apply2({ label: "remoteProgressCheckingHost", detail: "remoteProgressCheckingHostDetail", percent: 12 });
        let pending = action();
        poll();
        try {
          let result = await pending;
          return polling = !1, pollTimer !== void 0 && window.clearTimeout(pollTimer), apply2(readyProgress?.(result) ?? { label: "remoteProgressReady", detail: "remoteProgressReadyDetail", percent: 100 }), await new Promise((resolve) => window.setTimeout(resolve, 520)), result;
        } finally {
          polling = !1, pollTimer !== void 0 && window.clearTimeout(pollTimer), progressRun.current === runId && setProgress(void 0);
        }
      }
      function RemotePluginOptions(props) {
        let { t } = props, [open, setOpen] = React.useState(props.view === "page"), [serverUrl, setServerUrl] = React.useState(""), [portsBusy, setPortsBusy] = React.useState(!1), [previewPorts, setPreviewPorts] = React.useState(""), role = "host", [registrationCode, setRegistrationCode] = React.useState(""), [associations, setAssociations] = React.useState({}), [loaded, setLoaded] = React.useState(!1), [writable, setWritable] = React.useState(!1), [busy, setBusy] = React.useState(!1), [terminalEnabled, setTerminalEnabled] = React.useState(!1), [terminalBusy, setTerminalBusy] = React.useState(!1), [acpBackends, setAcpBackends] = React.useState([]), [acpAvailability, setAcpAvailability] = React.useState({}), [acpChecking, setAcpChecking] = React.useState({}), [acpCheckResults, setAcpCheckResults] = React.useState({}), [addingAcp, setAddingAcp] = React.useState(!1), [acpName, setAcpName] = React.useState(""), [acpCommand, setAcpCommand] = React.useState(""), [acpArguments, setAcpArguments] = React.useState("acp"), [reconnectBusy, setReconnectBusy] = React.useState(!1), [hostStatus, setHostStatus] = React.useState(void 0), [hostName, setHostName] = React.useState(""), [hostDeviceId, setHostDeviceId] = React.useState(""), [notice, setNotice] = React.useState(void 0), [error, setError] = React.useState(void 0), [settingsView, setSettingsView] = React.useState(void 0), persistedServerUrl = settingsView?.config.serverUrl ?? "https://dsh.r2049.cn", association = associations.client ?? associations.host, serverDirty = settingsView !== void 0 && serverUrl !== persistedServerUrl, draftDirty = serverDirty, applyView = (view) => {
          setSettingsView(view), setServerUrl(view.config.serverUrl ?? "https://dsh.r2049.cn"), setTerminalEnabled(view.config.terminal?.enabled ?? !0), setPreviewPorts((view.config.loopback?.ports ?? []).join(", ")), setAcpBackends((view.config.acp?.backends ?? []).map((item) => ({ id: item.id, enabled: item.enabled !== !1 }))), setAcpAvailability(view.acpAvailability ?? {}), setAssociations(view.associations ?? (view.association === void 0 ? {} : { host: view.association })), setWritable(view.writable), setLoaded(!0);
        }, load = async () => {
          let [view, status] = await Promise.all([
            props.control("settings.get"),
            props.control("status").catch(() => {
            })
          ]);
          applyView(view), setHostStatus(status?.host), setHostName(status?.deviceName ?? ""), setHostDeviceId(status?.host?.deviceId ?? "");
        };
        React.useEffect(() => {
          load().catch((reason) => setError(messageOf(reason)));
        }, []), React.useEffect(() => {
          if (association !== void 0)
            return props.statusFeed.subscribe((status) => {
              setHostStatus(status.host), setHostName(status.deviceName ?? ""), setHostDeviceId(status.host?.deviceId ?? "");
            });
        }, [association !== void 0]);
        let save = async (event) => {
          if (event?.preventDefault(), !(!writable || !serverDirty)) {
            setBusy(!0), setNotice(void 0), setError(void 0);
            try {
              let view = await props.control("settings.server.set", {
                serverUrl
              });
              applyView(view), setNotice({ key: "serverSaved" });
            } catch (reason) {
              setError(messageOf(reason));
            } finally {
              setBusy(!1);
            }
          }
        }, logout = async () => {
          setBusy(!0), setError(void 0), setNotice(void 0);
          try {
            let view = await props.control("settings.logout");
            applyView(view), setRegistrationCode(""), setNotice({ key: "signedOut" });
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setBusy(!1);
          }
        }, reconnectHost = async () => {
          setReconnectBusy(!0), setError(void 0), setNotice(void 0);
          try {
            let status = await props.control("host.reconnect");
            setHostStatus(status.host), setNotice({ key: "reconnectStarted" });
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setReconnectBusy(!1);
          }
        }, setCurrentDeviceControl = async (enabled) => {
          setBusy(!0), setError(void 0), setNotice(void 0);
          try {
            let status = await props.control("host.authorization.set", { enabled });
            setHostStatus(status.host);
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setBusy(!1);
          }
        }, setTerminalRemote = async (enabled) => {
          let previous = terminalEnabled, portsDraft = previewPorts;
          setTerminalEnabled(enabled), setTerminalBusy(!0), setError(void 0), setNotice(void 0);
          try {
            let view = await props.control("settings.development.set", { terminalEnabled: enabled });
            applyView(view), setPreviewPorts(portsDraft), setNotice({ key: "terminalSaved" });
          } catch (reason) {
            setTerminalEnabled(previous), setError(messageOf(reason));
          } finally {
            setTerminalBusy(!1);
          }
        }, savePreviewPorts = async () => {
          setPortsBusy(!0), setError(void 0), setNotice(void 0);
          try {
            let ports = previewPorts.trim() === "" ? [] : previewPorts.split(/[,，]/).map((value) => Number(value.trim())), view = await props.control("settings.development.set", { ports });
            applyView(view), setNotice({ key: "developmentSaved" });
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setPortsBusy(!1);
          }
        }, checkAcp = async (backend) => {
          if (!acpChecking[backend]) {
            setAcpChecking((current) => ({ ...current, [backend]: !0 })), setAcpCheckResults((current) => ({ ...current, [backend]: void 0 })), setError(void 0);
            try {
              let view = await props.control("settings.get");
              applyView(view);
              let available = view.acpAvailability?.[backend] === !0;
              !available && view.writable && view.config.acp?.backends?.some((item) => item.id === backend && item.enabled !== !1) && applyView(await props.control("settings.acp.set", { backend, enabled: !1 })), setAcpCheckResults((current) => ({ ...current, [backend]: available })), setNotice({ key: available ? "acpAvailable" : "acpUnavailable" }), window.setTimeout(() => setAcpCheckResults((current) => ({ ...current, [backend]: void 0 })), 5e3);
            } catch (reason) {
              setError(messageOf(reason));
            } finally {
              setAcpChecking((current) => ({ ...current, [backend]: !1 }));
            }
          }
        }, addAcp = async () => {
          setBusy(!0), setError(void 0);
          try {
            let view = await props.control("settings.acp.add", {
              id: acpName.trim(),
              command: acpCommand.trim(),
              args: acpArguments.trim() === "" ? [] : acpArguments.trim().split(/\s+/)
            });
            applyView(view), setAddingAcp(!1), setAcpName(""), setAcpCommand(""), setAcpArguments("acp");
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setBusy(!1);
          }
        }, removeAcp = async (backend) => {
          setBusy(!0), setError(void 0);
          try {
            let view = await props.control("settings.acp.remove", { id: backend });
            applyView(view);
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setBusy(!1);
          }
        }, discard = () => {
          settingsView !== void 0 && applyView(settingsView), setRegistrationCode(""), setNotice(void 0), setError(void 0);
        }, developmentSetting = React.createElement(
          "section",
          { className: "dshRemoteDevelopmentSettings" },
          React.createElement(
            "div",
            { className: "dshRemoteAuthorizationSetting" },
            React.createElement(
              "div",
              null,
              React.createElement("strong", null, t("terminalRemote")),
              React.createElement("p", null, t("terminalRemoteHint"))
            ),
            React.createElement("input", {
              type: "checkbox",
              role: "switch",
              checked: terminalEnabled,
              disabled: busy || terminalBusy || !writable,
              "aria-label": t("terminalRemote"),
              onChange: (event) => void setTerminalRemote(event.target.checked)
            })
          ),
          React.createElement(
            "div",
            { className: "dshRemotePathField" },
            React.createElement("span", null, t("previewPorts")),
            React.createElement(
              "div",
              { className: "dshRemotePortsRow" },
              React.createElement("input", {
                value: previewPorts,
                maxLength: 128,
                disabled: !writable,
                placeholder: "3000, 5173",
                "aria-label": t("previewPorts"),
                onChange: (event) => setPreviewPorts(event.target.value)
              }),
              React.createElement("button", {
                type: "button",
                disabled: portsBusy || terminalBusy || !writable,
                onClick: () => void savePreviewPorts()
              }, t("developmentSave"))
            ),
            React.createElement("small", null, t("previewPortsHint"))
          )
        ), acpSetting = React.createElement(
          "details",
          { className: "dshRemoteAuthorizationSetting dshRemoteAcpSetting" },
          React.createElement(
            "summary",
            null,
            React.createElement(
              "div",
              { className: "dshRemoteAcpSummaryText" },
              React.createElement("strong", null, t("agentBackends")),
              React.createElement("p", null, t("acpHint"), React.createElement("a", {
                href: "https://github.com/liguobao/ds-harness-remote/blob/feat/cursor-remote/docs/acp-remote.md",
                target: "_blank",
                rel: "noopener noreferrer",
                onClick: (event) => event.stopPropagation()
              }, t("acpDocumentation")))
            )
          ),
          React.createElement(
            "div",
            { className: "dshRemoteAcpList" },
            acpBackends.map((item) => React.createElement(
              "div",
              { key: item.id, className: "dshRemoteAuthorizationSetting" },
              React.createElement("div", null, React.createElement("strong", null, item.id === "codex" ? "CodeX" : item.id === "cursor" ? "Cursor" : item.id === "antigravity" ? "AGY" : item.id), null),
              React.createElement(
                "span",
                { className: "dshRemoteAcpCheckCell" },
                React.createElement(
                  "a",
                  { href: `#check-acp-${item.id}`, className: `dshRemoteAcpCheckLink${acpChecking[item.id] ? " isChecking" : acpCheckResults[item.id] === void 0 ? "" : acpCheckResults[item.id] ? " isPassed" : " isFailed"}`, onClick: (event) => {
                    event.preventDefault(), checkAcp(item.id);
                  } },
                  acpChecking[item.id] ? t("checkingAcp") : acpCheckResults[item.id] === void 0 ? t("checkAcp") : t(acpCheckResults[item.id] ? "acpCheckPassed" : "acpCheckFailed")
                )
              ),
              ["codex", "cursor", "antigravity"].includes(item.id) ? null : React.createElement("a", { href: `#remove-acp-${item.id}`, className: "dshRemoteAcpRemoveLink", onClick: (event) => {
                event.preventDefault(), removeAcp(item.id);
              } }, t("removeAcp")),
              React.createElement("input", {
                type: "checkbox",
                role: "switch",
                checked: settingsView?.config.acp?.enabled === !0 && item.enabled && acpAvailability[item.id] === !0,
                "aria-label": item.id,
                disabled: busy || !writable || acpChecking[item.id] === !0 || acpAvailability[item.id] !== !0,
                onChange: (event) => void props.control("settings.acp.set", { backend: item.id, enabled: event.target.checked }).then((view) => {
                  applyView(view), setAcpBackends((view.config.acp?.backends ?? []).map((v) => ({ id: v.id, enabled: v.enabled !== !1 })));
                }).catch((reason) => setError(messageOf(reason)))
              })
            )),
            addingAcp ? React.createElement(
              "div",
              { className: "dshRemoteAcpAddForm" },
              React.createElement("input", { value: acpName, placeholder: t("acpName"), "aria-label": t("acpName"), onChange: (event) => setAcpName(event.target.value) }),
              React.createElement("input", { value: acpCommand, placeholder: t("acpCommand"), "aria-label": t("acpCommand"), onChange: (event) => setAcpCommand(event.target.value) }),
              React.createElement("input", { value: acpArguments, placeholder: t("acpArguments"), "aria-label": t("acpArguments"), onChange: (event) => setAcpArguments(event.target.value) }),
              React.createElement("button", { type: "button", disabled: busy || acpName.trim() === "" || acpCommand.trim() === "", onClick: () => void addAcp() }, t("addAcp"))
            ) : React.createElement("a", { href: "#add-acp", className: "dshRemoteAcpAddLink", onClick: (event) => {
              event.preventDefault(), setAddingAcp(!0);
            } }, t("addAcp"))
          )
        );
        return props.view === "summary" ? React.createElement("span", null, t("pluginDescription")) : React.createElement(
          props.view === "page" ? "div" : "li",
          { className: `dshRemotePluginCard${open ? " isOpen" : ""}${props.view === "page" ? " dshRemotePluginModern" : ""}` },
          React.createElement(
            "div",
            { className: "dshRemotePluginCardHeader" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "dshRemotePluginCardToggle",
                "aria-expanded": open,
                "aria-label": t(open ? "collapseSettings" : "expandSettings", { name: t("pluginTitle") }),
                onClick: () => setOpen((current) => !current)
              },
              React.createElement(
                "span",
                { className: "dshRemotePluginCardHeading" },
                React.createElement("strong", null, t("pluginTitle")),
                React.createElement("span", null, t("pluginDescription"))
              ),
              draftDirty ? React.createElement("span", { className: "dshRemotePluginCardStatus" }, t("unsaved")) : association === void 0 ? null : React.createElement("span", {
                className: `dshRemotePluginCardStatus${connectionStatusClass(hostStatus)}`
              }, hostStatus === void 0 ? t("associated") : connectionStatusLabel(hostStatus, t)),
              React.createElement("span", { className: "dshRemotePluginCardChevron", "aria-hidden": !0 }, "\u2304")
            )
          ),
          open ? React.createElement(
            "div",
            { className: "dshRemotePluginCardBody" },
            loaded ? association !== void 0 ? React.createElement(
              "div",
              { className: "dshRemoteSettings" },
              React.createElement(
                "div",
                { className: "dshRemoteSettingsTop" },
                React.createElement(
                  "div",
                  { className: "dshRemoteAssociation" },
                  React.createElement("span", null, t(association.account === void 0 ? "authorization" : "account")),
                  React.createElement("strong", null, association.account ?? t("authorizationComplete")),
                  React.createElement("p", null, association.account === void 0 ? serverUrl : t("authorizedOn", { role: "Remote", serverUrl }))
                )
              ),
              React.createElement(
                "div",
                { className: "dshRemoteHostIdentity" },
                React.createElement(
                  "div",
                  null,
                  React.createElement("span", null, t("hostName")),
                  React.createElement("strong", null, hostName || "\u2014")
                ),
                React.createElement(
                  "div",
                  null,
                  React.createElement("span", null, t("deviceId")),
                  React.createElement("code", null, hostDeviceId || "\u2014")
                )
              ),
              React.createElement(
                "div",
                { className: "dshRemoteField" },
                React.createElement("label", { htmlFor: "dsh-remote-server-url-authorized" }, t("serverUrl")),
                React.createElement("input", {
                  id: "dsh-remote-server-url-authorized",
                  type: "url",
                  value: serverUrl,
                  disabled: !0,
                  required: !0,
                  placeholder: "https://dsh.r2049.cn",
                  onChange: (event) => {
                    setServerUrl(event.target.value), setNotice(void 0);
                  }
                }),
                React.createElement("p", null, t("serverUrlHint"))
              ),
              developmentSetting,
              acpSetting,
              React.createElement(
                "div",
                { className: "dshRemoteAuthorizationSetting" },
                React.createElement(
                  "div",
                  null,
                  React.createElement("strong", null, t("allowControlCurrentDevice")),
                  React.createElement("p", null, t("thisMachineHost"))
                ),
                React.createElement("input", {
                  type: "checkbox",
                  role: "switch",
                  disabled: busy,
                  "aria-label": t("allowControlCurrentDevice"),
                  checked: hostStatus?.authorized === !0,
                  onChange: (event) => void setCurrentDeviceControl(event.target.checked)
                })
              ),
              React.createElement(
                "div",
                { className: "dshRemoteConnection", "aria-live": "polite" },
                React.createElement(
                  "div",
                  { className: "dshRemoteConnectionSummary" },
                  React.createElement("span", null, t("connection")),
                  React.createElement(
                    "strong",
                    null,
                    React.createElement("span", {
                      className: `dshRemoteConnectionDot${connectionStatusClass(hostStatus)}`,
                      "aria-hidden": !0
                    }),
                    connectionStatusLabel(hostStatus, t)
                  ),
                  React.createElement("p", null, hostStatus === void 0 ? t("checkingConnection") : hostStatus.lastActiveAt === void 0 ? t("neverConnected") : t("lastActive", { time: formatLocalTime(hostStatus.lastActiveAt) }))
                ),
                React.createElement("button", {
                  type: "button",
                  className: "dshRemoteReconnect",
                  disabled: reconnectBusy || hostStatus?.configured === !1,
                  onClick: () => void reconnectHost()
                }, t(reconnectBusy ? "reconnectingAction" : "reconnect"))
              ),
              hostStatus?.error === void 0 || hostStatus.online ? null : React.createElement("p", { className: "dshRemoteConnectionIssue", role: "status" }, connectionErrorMessage(hostStatus.error, t)),
              writable ? null : React.createElement("p", { className: "dshRemoteError" }, t("readOnly")),
              React.createElement(
                "div",
                { className: "dshRemoteSettingsFooter" },
                React.createElement("p", {
                  className: error !== void 0 ? "dshRemoteError" : "dshRemoteNotice",
                  role: error !== void 0 ? "alert" : "status"
                }, error ?? (notice === void 0 ? "" : t(notice.key, notice.params))),
                draftDirty ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement("button", { type: "button", className: "dshRemoteDiscard", disabled: busy, onClick: discard }, t("discard")),
                  React.createElement("button", { type: "button", className: "dshRemoteSave", disabled: busy || !writable, onClick: () => void save() }, t(busy ? "saving" : "save")),
                  React.createElement("button", { type: "button", className: "dshRemoteDiscard", disabled: busy || !writable, onClick: () => void logout() }, t(busy ? "signingOut" : "signOut"))
                ) : React.createElement("button", {
                  type: "button",
                  className: "dshRemoteDiscard",
                  disabled: busy || !writable,
                  onClick: () => void logout()
                }, t(busy ? "signingOut" : "signOut"))
              )
            ) : React.createElement(
              "form",
              { className: "dshRemoteSettings", noValidate: !0, onSubmit: (event) => void save(event) },
              React.createElement(
                "div",
                { className: "dshRemoteHostIdentity" },
                React.createElement(
                  "div",
                  null,
                  React.createElement("span", null, t("hostName")),
                  React.createElement("strong", null, hostName || "\u2014")
                ),
                React.createElement(
                  "div",
                  null,
                  React.createElement("span", null, t("deviceId")),
                  React.createElement("code", null, hostDeviceId || "\u2014")
                )
              ),
              React.createElement(
                "div",
                { className: "dshRemoteField" },
                React.createElement("label", { htmlFor: "dsh-remote-server-url" }, t("serverUrl")),
                React.createElement("input", {
                  id: "dsh-remote-server-url",
                  type: "url",
                  value: serverUrl,
                  disabled: busy || !writable,
                  required: !0,
                  placeholder: "https://dsh.r2049.cn",
                  onChange: (event) => {
                    setServerUrl(event.target.value), setNotice(void 0);
                  }
                }),
                React.createElement("p", null, t("serverUrlHint"))
              ),
              developmentSetting,
              acpSetting,
              React.createElement("p", { className: "dshRemoteSettingsState" }, t("authorizeFromRemote")),
              writable ? null : React.createElement("p", { className: "dshRemoteError" }, t("readOnly")),
              React.createElement(
                "div",
                { className: "dshRemoteSettingsFooter" },
                React.createElement("p", {
                  className: error !== void 0 ? "dshRemoteError" : "dshRemoteNotice",
                  role: error !== void 0 ? "alert" : "status"
                }, error ?? (notice === void 0 ? "" : t(notice.key, notice.params))),
                React.createElement("button", { type: "button", className: "dshRemoteDiscard", disabled: busy || !draftDirty, onClick: discard }, t("discard")),
                React.createElement("button", { type: "submit", className: "dshRemoteSave", disabled: busy || !writable || !serverDirty }, t(busy ? "saving" : "save"))
              )
            ) : React.createElement("p", { className: "dshRemoteSettingsState" }, error ?? t("loadingSettings"))
          ) : null
        );
      }
      function RemoteWorkspaceAction(props) {
        let { t } = props, [open, setOpen] = React.useState(!1), [status, setStatus] = React.useState(void 0), [devices, setDevices] = React.useState([]), [selectedHost, setSelectedHost] = React.useState(void 0), [connectingHost, setConnectingHost] = React.useState(void 0), [workspaces, setWorkspaces] = React.useState([]), [codexWorkspaces, setCodexWorkspaces] = React.useState([]), [cursorWorkspaces, setCursorWorkspaces] = React.useState([]), [antigravityWorkspaces, setAntigravityWorkspaces] = React.useState([]), [workspaceBackend, setWorkspaceBackend] = React.useState("harness"), [codexWorkspaceId, setCodexWorkspaceId] = React.useState(void 0), [cursorWorkspaceId, setCursorWorkspaceId] = React.useState(void 0), [antigravityWorkspaceId, setAntigravityWorkspaceId] = React.useState(void 0), [directory, setDirectory] = React.useState(void 0), [path, setPath] = React.useState(""), [addingWorkspace, setAddingWorkspace] = React.useState(!1), [showAllWorkspaces, setShowAllWorkspaces] = React.useState(!1), [showAllCodexWorkspaces, setShowAllCodexWorkspaces] = React.useState(!1), [devicesOpen, setDevicesOpen] = React.useState(!1), [showAllCursorWorkspaces, setShowAllCursorWorkspaces] = React.useState(!1), [showAllAntigravityWorkspaces, setShowAllAntigravityWorkspaces] = React.useState(!1), workspaceListId = "dsh-remote-workspace-list", codexWorkspaceHeadingId = "dsh-remote-codex-workspace-heading", codexWorkspaceListId = "dsh-remote-codex-workspace-list", cursorWorkspaceHeadingId = "dsh-remote-cursor-workspace-heading", cursorWorkspaceListId = "dsh-remote-cursor-workspace-list", antigravityWorkspaceHeadingId = "dsh-remote-antigravity-workspace-heading", antigravityWorkspaceListId = "dsh-remote-antigravity-workspace-list", [busy, setBusy] = React.useState(!1), [needsAuthorization, setNeedsAuthorization] = React.useState(!1), [email, setEmail] = React.useState(""), [password, setPassword] = React.useState(""), [loginServerUrl, setLoginServerUrl] = React.useState("https://dsh.r2049.cn"), [loginMethod, setLoginMethod] = React.useState(props.preferredQrProvider), [loginMethodManuallySelected, setLoginMethodManuallySelected] = React.useState(!1), [qrSession, setQrSession] = React.useState(void 0), [qrImage, setQrImage] = React.useState(void 0), [qrExpired, setQrExpired] = React.useState(!1), [progress, setProgress] = React.useState(void 0), progressRun = React.useRef(0), qrFlowRun = React.useRef(0), [notice, setNotice] = React.useState(void 0), [error, setError] = React.useState(void 0);
        React.useEffect(() => {
          open || setDevicesOpen(!1);
        }, [open]), React.useEffect(() => {
          if (!open) return;
          let closeOnEscape = (event) => {
            if (event.key === "Escape") {
              if (devicesOpen) {
                event.stopPropagation(), setDevicesOpen(!1);
                return;
              }
              setOpen(!1);
            }
          };
          return window.addEventListener("keydown", closeOnEscape), () => window.removeEventListener("keydown", closeOnEscape);
        }, [open, devicesOpen]), React.useEffect(() => {
          if (!devicesOpen) return;
          let closeOnPointer = (event) => {
            let target = event.target;
            target instanceof Element && target.closest(".dshRemoteConnectedMenu") === null && setDevicesOpen(!1);
          };
          return window.addEventListener("mousedown", closeOnPointer), () => window.removeEventListener("mousedown", closeOnPointer);
        }, [devicesOpen]), React.useEffect(() => {
          (status?.host?.connectedClients?.length ?? 0) === 0 && setDevicesOpen(!1);
        }, [status?.host?.connectedClients?.length]), React.useEffect(() => {
          props.control("status").then(setStatus).catch(() => {
          });
        }, []), React.useEffect(() => {
          status?.serverUrl !== void 0 && loginServerUrl === "https://dsh.r2049.cn" && setLoginServerUrl(status.serverUrl);
        }, [status?.serverUrl]), React.useEffect(() => {
          let remoteActive = status?.mode === "remote";
          return document.documentElement.classList.toggle("dshRemoteTargetActive", remoteActive), () => {
            remoteActive && document.documentElement.classList.remove("dshRemoteTargetActive");
          };
        }, [status?.mode]);
        let startQrLogin = async (provider) => {
          let run = ++qrFlowRun.current;
          setBusy(!0), setError(void 0), setQrExpired(!1);
          try {
            let session = await props.control("client.account.qr.start", { provider }), image = await import_qrcode.default.toDataURL(session.scanUrl, {
              width: 184,
              margin: 1,
              errorCorrectionLevel: "L"
            });
            if (run !== qrFlowRun.current) return;
            setQrSession(session), setQrImage(image);
          } catch (reason) {
            run === qrFlowRun.current && setError(messageOf(reason));
          } finally {
            run === qrFlowRun.current && setBusy(!1);
          }
        };
        React.useEffect(() => {
          !open || !needsAuthorization || loginMethod === "password" || qrSession !== void 0 || qrExpired || startQrLogin(loginMethod);
        }, [open, needsAuthorization, loginMethod, qrSession, qrExpired]), React.useEffect(() => {
          if (!open || loginMethod === "password" || qrSession === void 0) return;
          let active = !0, polling = !1, settled = !1, run = qrFlowRun.current, timer, poll = () => {
            polling || settled || (polling = !0, props.control("client.account.qr.poll", { qrId: qrSession.qrId }).then(async (result) => {
              if (!(!active || settled || run !== qrFlowRun.current))
                if (result.status === "complete") {
                  settled = !0, timer !== void 0 && window.clearInterval(timer), setBusy(!0), setError(void 0), setQrExpired(!1), setNeedsAuthorization(!1);
                  try {
                    let [nextDevices, nextStatus] = await Promise.all([
                      props.control("devices"),
                      props.control("status")
                    ]);
                    active && run === qrFlowRun.current && (setDevices(nextDevices), setStatus(nextStatus));
                  } catch (reason) {
                    active && run === qrFlowRun.current && setError(messageOf(reason));
                  } finally {
                    run === qrFlowRun.current && (setQrSession(void 0), setQrImage(void 0), setBusy(!1));
                  }
                } else result.status === "expired" && (settled = !0, timer !== void 0 && window.clearInterval(timer), setQrExpired(!0), setQrSession(void 0), setQrImage(void 0));
            }).catch((reason) => {
              active && !settled && run === qrFlowRun.current && setError(messageOf(reason));
            }).finally(() => {
              polling = !1;
            }));
          };
          return poll(), timer = window.setInterval(poll, 1500), () => {
            active = !1, timer !== void 0 && window.clearInterval(timer);
          };
        }, [open, loginMethod, qrSession]), React.useEffect(() => {
          loginMethodManuallySelected || loginMethod === props.preferredQrProvider || (qrFlowRun.current += 1, setLoginMethod(props.preferredQrProvider), setQrSession(void 0), setQrImage(void 0), setQrExpired(!1), setError(void 0));
        }, [props.preferredQrProvider, loginMethodManuallySelected]);
        let selectLoginMethod = (method) => {
          setLoginMethodManuallySelected(!0), method !== loginMethod && (qrFlowRun.current += 1, setLoginMethod(method), setQrSession(void 0), setQrImage(void 0), setQrExpired(!1), setError(void 0));
        }, orderedQrProviders = props.preferredQrProvider === "zhihu" ? ["zhihu", "github"] : ["github", "zhihu"], qrLoginTab = (provider) => React.createElement("button", {
          key: provider,
          type: "button",
          role: "tab",
          id: `dsh-remote-${provider}-tab`,
          "aria-selected": loginMethod === provider,
          "aria-controls": `dsh-remote-${provider}-panel`,
          className: loginMethod === provider ? "isActive" : "",
          disabled: busy,
          onClick: () => selectLoginMethod(provider)
        }, t(provider === "github" ? "githubLogin" : "zhihuLogin")), selectHost = async (host) => {
          setBusy(!0), setError(void 0), setConnectingHost(host), setCodexWorkspaces([]), setCursorWorkspaces([]), setAntigravityWorkspaces([]), setShowAllWorkspaces(!1), setShowAllCodexWorkspaces(!1), setShowAllCursorWorkspaces(!1), setShowAllAntigravityWorkspaces(!1);
          try {
            let result = await runConnectHostProgress(
              status?.preferredTransports,
              host.deviceId,
              props.control,
              { label: "remoteProgressLoadingWorkspaces", detail: "remoteProgressLoadingWorkspacesDetail" },
              setProgress,
              progressRun,
              async () => {
                let nextWorkspaces = await props.control("workspaces.list", {
                  targetDeviceId: host.deviceId
                }), nextCodexWorkspaces = await props.control("codex.workspaces.list", {
                  targetDeviceId: host.deviceId
                }).catch(() => []), nextCursorWorkspaces = await props.control("cursor.workspaces.list", {
                  targetDeviceId: host.deviceId
                }).catch(() => []), nextAntigravityWorkspaces = await props.control("antigravity.workspaces.list", {
                  targetDeviceId: host.deviceId
                }).catch(() => []), nextStatus = await props.control("status").catch(() => {
                });
                return nextStatus !== void 0 && setStatus(nextStatus), {
                  workspaces: nextWorkspaces,
                  codexWorkspaces: nextCodexWorkspaces,
                  cursorWorkspaces: nextCursorWorkspaces,
                  antigravityWorkspaces: nextAntigravityWorkspaces,
                  status: nextStatus
                };
              },
              (result2) => connectedProgress(result2.status)
            );
            setWorkspaces(result.workspaces), setCodexWorkspaces(result.codexWorkspaces), setCursorWorkspaces(result.cursorWorkspaces), setAntigravityWorkspaces(result.antigravityWorkspaces), setWorkspaceBackend("harness"), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setSelectedHost(host), setPath(""), setAddingWorkspace(!1), setDirectory(void 0);
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setConnectingHost(void 0), setBusy(!1);
          }
        }, browseDirectory = async (nextPath) => {
          if (selectedHost !== void 0) {
            setBusy(!0), setError(void 0);
            try {
              let listing = await props.control("directory.list", {
                targetDeviceId: selectedHost.deviceId,
                ...nextPath === void 0 ? {} : { path: nextPath }
              });
              setDirectory(listing), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setPath(listing.path);
            } catch (reason) {
              setError(messageOf(reason));
            } finally {
              setBusy(!1);
            }
          }
        }, startAddingWorkspace = (backend) => {
          setAddingWorkspace(!0), setWorkspaceBackend(backend), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setShowAllWorkspaces(!1), setShowAllCodexWorkspaces(!1), setShowAllCursorWorkspaces(!1), setShowAllAntigravityWorkspaces(!1), setDirectory(void 0), setPath(""), browseDirectory();
        }, cancelAddingWorkspace = () => {
          setAddingWorkspace(!1), setWorkspaceBackend("harness"), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setDirectory(void 0), setPath("");
        }, refreshRemote = async () => {
          setBusy(!0), setNotice(void 0), setError(void 0);
          try {
            let nextStatus = await props.control("status");
            if (setStatus(nextStatus), !nextStatus.available) {
              setDevices([]), setNeedsAuthorization(!1), setSelectedHost(void 0), setWorkspaces([]), setCodexWorkspaces([]), setCursorWorkspaces([]), setAntigravityWorkspaces([]), setShowAllWorkspaces(!1), setShowAllCodexWorkspaces(!1), setShowAllCursorWorkspaces(!1), setShowAllAntigravityWorkspaces(!1), setWorkspaceBackend("harness"), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setPath(""), setAddingWorkspace(!1), setDirectory(void 0);
              return;
            }
            try {
              let nextDevices = await props.control("devices");
              if (setDevices(nextDevices), setNeedsAuthorization(!1), selectedHost !== void 0) {
                let nextSelectedHost = nextDevices.find((device) => device.deviceId === selectedHost.deviceId);
                nextSelectedHost === void 0 ? (setSelectedHost(void 0), setWorkspaces([]), setCodexWorkspaces([]), setCursorWorkspaces([]), setAntigravityWorkspaces([]), setShowAllWorkspaces(!1), setShowAllCodexWorkspaces(!1), setShowAllCursorWorkspaces(!1), setShowAllAntigravityWorkspaces(!1), setWorkspaceBackend("harness"), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setPath(""), setAddingWorkspace(!1), setDirectory(void 0)) : (setSelectedHost(nextSelectedHost), props.control("workspaces.list", { targetDeviceId: nextSelectedHost.deviceId }).then((w) => setWorkspaces(w)).catch(() => {
                }), props.control("codex.workspaces.list", { targetDeviceId: nextSelectedHost.deviceId }).then((w) => setCodexWorkspaces(w)).catch(() => {
                }), props.control("cursor.workspaces.list", { targetDeviceId: nextSelectedHost.deviceId }).then((w) => setCursorWorkspaces(w)).catch(() => {
                }), props.control("antigravity.workspaces.list", { targetDeviceId: nextSelectedHost.deviceId }).then((w) => setAntigravityWorkspaces(w)).catch(() => {
                }));
              }
            } catch {
              setDevices([]), setNeedsAuthorization(!0), setSelectedHost(void 0), setWorkspaces([]), setCodexWorkspaces([]), setCursorWorkspaces([]), setAntigravityWorkspaces([]), setShowAllWorkspaces(!1), setShowAllCodexWorkspaces(!1), setShowAllCursorWorkspaces(!1), setShowAllAntigravityWorkspaces(!1), setWorkspaceBackend("harness"), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setPath(""), setAddingWorkspace(!1), setDirectory(void 0);
            }
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setBusy(!1);
          }
        }, show = async () => {
          setShowAllWorkspaces(!1), setShowAllCodexWorkspaces(!1), setShowAllCursorWorkspaces(!1), setShowAllAntigravityWorkspaces(!1), setOpen(!0), await refreshRemote();
        };
        React.useEffect(() => {
          if (!(!open || selectedHost !== void 0))
            return props.statusFeed.subscribe(setStatus);
        }, [open, selectedHost]);
        let chooseAnotherHost = () => {
          setSelectedHost(void 0), setWorkspaces([]), setCodexWorkspaces([]), setCursorWorkspaces([]), setAntigravityWorkspaces([]), setShowAllWorkspaces(!1), setShowAllCodexWorkspaces(!1), setShowAllCursorWorkspaces(!1), setShowAllAntigravityWorkspaces(!1), setWorkspaceBackend("harness"), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setDirectory(void 0), setPath(""), setAddingWorkspace(!1), setError(void 0);
        }, signInClient = async () => {
          if (!(email.trim() === "" || password === "" || loginServerUrl.trim() === "")) {
            setBusy(!0), setError(void 0);
            try {
              await props.control("settings.configure", {
                role: "client",
                serverUrl: loginServerUrl.trim(),
                email: email.trim(),
                password
              }), setDevices(await props.control("devices")), setStatus(await props.control("status")), setNeedsAuthorization(!1), setPassword("");
            } catch (reason) {
              setError(messageOf(reason));
            } finally {
              setBusy(!1);
            }
          }
        }, openLocalWorkspaces = async () => {
          setBusy(!0), setError(void 0);
          try {
            await props.control("mode.set", { mode: "local" }), window.location.reload();
          } catch (reason) {
            setError(messageOf(reason)), setBusy(!1);
          }
        }, setCurrentDeviceControl = async (enabled) => {
          setBusy(!0), setError(void 0);
          try {
            setStatus(await props.control("host.authorization.set", { enabled }));
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setBusy(!1);
          }
        }, logoutRemote = async () => {
          setBusy(!0), setError(void 0);
          try {
            await props.control("settings.logout"), setDevices([]), setNeedsAuthorization(!0), setQrSession(void 0), setQrImage(void 0), setQrExpired(!1), setStatus(await props.control("status"));
          } catch (reason) {
            setError(messageOf(reason));
          } finally {
            setBusy(!1);
          }
        }, openWorkspace = async (selection) => {
          let targetBackend = selection?.backend ?? workspaceBackend, targetPath = (selection?.path ?? path).trim(), targetCodexWorkspaceId = selection?.backend === "codex" ? selection.workspaceId : selection === void 0 ? codexWorkspaceId : void 0, targetCursorWorkspaceId = selection?.backend === "cursor" ? selection.workspaceId : selection === void 0 ? cursorWorkspaceId : void 0, targetAntigravityWorkspaceId = selection?.backend === "antigravity" ? selection.workspaceId : selection === void 0 ? antigravityWorkspaceId : void 0, createWorkspace = selection === void 0 && addingWorkspace;
          if (!(selectedHost === void 0 || targetPath === "" || !createWorkspace && targetBackend === "codex" && targetCodexWorkspaceId === void 0 || !createWorkspace && targetBackend === "cursor" && targetCursorWorkspaceId === void 0 && targetPath === "" || !createWorkspace && targetBackend === "antigravity" && targetAntigravityWorkspaceId === void 0 && targetPath === "")) {
            setBusy(!0), setError(void 0);
            try {
              let nextStatus = await (targetBackend === "codex" ? createWorkspace ? props.control("codex.workspace.create", {
                targetDeviceId: selectedHost.deviceId,
                path: targetPath
              }) : props.control("codex.workspace.open", {
                targetDeviceId: selectedHost.deviceId,
                workspaceId: targetCodexWorkspaceId
              }) : targetBackend === "cursor" ? createWorkspace || targetCursorWorkspaceId === void 0 ? props.control("cursor.workspace.create", {
                targetDeviceId: selectedHost.deviceId,
                path: targetPath
              }) : props.control("cursor.workspace.open", {
                targetDeviceId: selectedHost.deviceId,
                workspaceId: targetCursorWorkspaceId
              }) : targetBackend === "antigravity" ? createWorkspace || targetAntigravityWorkspaceId === void 0 ? props.control("antigravity.workspace.create", {
                targetDeviceId: selectedHost.deviceId,
                path: targetPath
              }) : props.control("antigravity.workspace.open", {
                targetDeviceId: selectedHost.deviceId,
                workspaceId: targetAntigravityWorkspaceId
              }) : props.control("workspace.open", {
                targetDeviceId: selectedHost.deviceId,
                path: targetPath
              }));
              setStatus(nextStatus), nextStatus.workspaceSelection !== void 0 && window.sessionStorage.setItem(pendingWorkspaceSelectionKey, JSON.stringify(nextStatus.workspaceSelection)), window.location.reload();
            } catch (reason) {
              setError(messageOf(reason)), setBusy(!1);
            }
          }
        }, remoteLabel = status?.mode === "remote" ? t("activeRemote", { name: status.target?.name ?? t("host") }) : t("remoteEntry"), visibleWorkspaces = showAllWorkspaces ? workspaces : workspaces.slice(0, 3), visibleCodexWorkspaces = showAllCodexWorkspaces ? codexWorkspaces : codexWorkspaces.slice(0, 3), visibleCursorWorkspaces = showAllCursorWorkspaces ? cursorWorkspaces : cursorWorkspaces.slice(0, 3), visibleAntigravityWorkspaces = showAllAntigravityWorkspaces ? antigravityWorkspaces : antigravityWorkspaces.slice(0, 3), codexAvailable = status?.remoteFeatures?.codex === !0, cursorAvailable = status?.remoteFeatures?.cursor === !0, antigravityAvailable = status?.remoteFeatures?.antigravity === !0, selectedHostDetails = selectedHost === void 0 ? void 0 : [
          formatPlatform(selectedHost.platform),
          selectedHost.harnessVersion === void 0 ? void 0 : t("harnessVersion", { version: selectedHost.harnessVersion }),
          selectedHost.clientVersion === void 0 ? void 0 : t("pluginVersion", { version: selectedHost.clientVersion })
        ].filter(Boolean).join(" \xB7 "), connectedClients = status?.host?.connectedClients ?? [], connectedCount = connectedClients.length, connectedCountLabel = t("connectedClientCount", { count: connectedCount }), connectedMenu = !needsAuthorization && status?.hostAuthorizationAvailable === !0 ? React.createElement(
          "div",
          {
            className: `dshRemoteConnectedMenu${devicesOpen ? " isOpen" : ""}`
          },
          React.createElement("a", {
            href: connectedCount > 0 ? "#connected-devices" : void 0,
            className: `dshRemoteConnectedCount${connectedCount > 0 ? " isOnline isInteractive" : ""}`,
            "aria-expanded": connectedCount > 0 ? devicesOpen : void 0,
            "aria-haspopup": connectedCount > 0 ? "dialog" : void 0,
            title: connectedCountLabel,
            "aria-label": connectedCountLabel,
            onClick: (event) => {
              event.preventDefault(), connectedCount !== 0 && setDevicesOpen((current) => !current);
            }
          }, connectedCountLabel),
          devicesOpen && connectedCount > 0 ? React.createElement(
            "div",
            {
              className: "dshRemoteConnectedPanel",
              id: "connected-devices",
              role: "dialog",
              "aria-label": t("currentConnectedDevices")
            },
            React.createElement("strong", { className: "dshRemoteConnectedPanelTitle" }, t("currentConnectedDevices")),
            React.createElement(
              "div",
              { className: "dshRemoteClientList", "aria-label": t("currentConnectedDevices") },
              ...connectedClients.map((client) => React.createElement(
                "div",
                {
                  key: client.deviceId,
                  className: "dshRemoteClientRow"
                },
                React.createElement(
                  "span",
                  null,
                  React.createElement("strong", null, client.name.trim() === "" ? t("unknownDevice") : client.name),
                  React.createElement("small", null, [
                    client.platform === void 0 ? void 0 : formatPlatform(client.platform),
                    connectedClientModeLabel(client.mode, t)
                  ].filter(Boolean).join(" \xB7 "))
                ),
                React.createElement("small", { className: "dshRemoteClientOnline" }, t("connected"))
              ))
            )
          ) : null
        ) : null, listedHosts = connectingHost === void 0 ? devices : [connectingHost];
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            { className: `dshRemoteSidebarEntry${status?.mode === "remote" ? " isActive" : ""}${props.wide ? " isWide" : " isRail"}` },
            React.createElement(status?.mode === "remote" ? "div" : "button", {
              ...status?.mode === "remote" ? {} : { type: "button", onClick: () => void show() },
              className: "dshRemoteModeButton",
              title: remoteLabel,
              "aria-label": remoteLabel
            }, React.createElement(
              "svg",
              {
                className: "dshRemoteComputerIcon",
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.7,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": !0
              },
              React.createElement("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
              React.createElement("path", { d: "M8 21h8M12 17v4" })
            ), props.wide ? React.createElement("span", { className: "dshRemoteSidebarLabel" }, remoteLabel) : null),
            status?.mode === "remote" && props.wide ? React.createElement("button", {
              type: "button",
              className: "dshRemoteExitLink",
              disabled: busy,
              onClick: () => void openLocalWorkspaces()
            }, t("exitRemote")) : null
          ),
          open ? React.createElement("div", {
            className: "dshRemoteBackdrop",
            role: "presentation",
            onMouseDown: (event) => {
              event.target === event.currentTarget && setOpen(!1);
            }
          }, React.createElement(
            "section",
            {
              className: `dshRemotePage${selectedHost === void 0 ? "" : " hasSelectedHost"}`,
              role: "dialog",
              "aria-modal": !0,
              "aria-label": selectedHost?.name ?? t("remoteTitle")
            },
            React.createElement(
              "header",
              { className: "dshRemotePageHeader" },
              React.createElement(
                "div",
                { className: "dshRemotePageIntro" },
                React.createElement(
                  "div",
                  { className: "dshRemotePageTitleRow" },
                  React.createElement("strong", null, selectedHost?.name ?? t("remoteTitle")),
                  selectedHost === void 0 ? React.createElement("a", {
                    className: "dshRemoteStarLink",
                    href: "https://github.com/liguobao/ds-harness-remote",
                    target: "_blank",
                    rel: "noreferrer"
                  }, t("starProject")) : null
                ),
                React.createElement("p", null, selectedHostDetails ?? t("remoteDescription"))
              ),
              React.createElement(
                "div",
                { className: "dshRemotePageActions" },
                selectedHost === void 0 ? null : React.createElement("button", {
                  type: "button",
                  className: "dshRemotePageBack",
                  disabled: busy,
                  title: t("backToHosts"),
                  onClick: chooseAnotherHost
                }, t("backToHosts")),
                React.createElement("button", {
                  type: "button",
                  className: "dshRemotePageRefresh",
                  disabled: busy,
                  title: t("refreshRemote"),
                  "aria-label": t("refreshRemote"),
                  onClick: () => void refreshRemote()
                }, t("refreshRemoteShort")),
                React.createElement("button", { type: "button", className: "dshRemotePageClose", onClick: () => setOpen(!1), "aria-label": t("close") }, "\xD7")
              )
            ),
            React.createElement(
              "main",
              { className: "dshRemotePageBody" },
              status?.mode === "remote" ? React.createElement("button", {
                type: "button",
                className: "dshRemoteLocalLink",
                disabled: busy,
                onClick: () => void openLocalWorkspaces()
              }, t("openLocalWorkspaces")) : null,
              React.createElement(
                React.Fragment,
                null,
                needsAuthorization ? React.createElement(
                  "section",
                  { className: "dshRemoteEnable" },
                  React.createElement(
                    "div",
                    { className: "dshRemoteLoginHeading" },
                    React.createElement("strong", { className: "dshRemoteLoginTitle" }, t("signInClient")),
                    React.createElement("span", null, t("signInClientDescription"))
                  ),
                  React.createElement(
                    "div",
                    { className: "dshRemoteLoginTabs", role: "tablist" },
                    ...orderedQrProviders.map(qrLoginTab),
                    React.createElement("button", {
                      type: "button",
                      role: "tab",
                      id: "dsh-remote-password-tab",
                      "aria-selected": loginMethod === "password",
                      "aria-controls": "dsh-remote-password-panel",
                      className: loginMethod === "password" ? "isActive" : "",
                      disabled: busy,
                      onClick: () => selectLoginMethod("password")
                    }, t("accountPasswordLogin"))
                  ),
                  loginMethod !== "password" ? React.createElement(
                    "div",
                    {
                      className: "dshRemoteQrLogin",
                      role: "tabpanel",
                      id: `dsh-remote-${loginMethod}-panel`,
                      "aria-labelledby": `dsh-remote-${loginMethod}-tab`
                    },
                    qrImage === void 0 ? React.createElement(
                      "div",
                      { className: "dshRemoteQrPlaceholder", "aria-busy": busy },
                      qrExpired ? React.createElement("p", null, t("qrLoginExpired")) : React.createElement("span", null, t("checkingConnection"))
                    ) : qrSession !== void 0 ? React.createElement(
                      "a",
                      {
                        className: "dshRemoteQrOpen",
                        href: qrSession.scanUrl,
                        target: "_blank",
                        rel: "noopener noreferrer",
                        "aria-label": t("openInBrowser")
                      },
                      React.createElement("img", {
                        src: qrImage,
                        width: 184,
                        height: 184,
                        alt: t(loginMethod === "github" ? "scanWithGitHub" : "scanWithZhihu")
                      }),
                      React.createElement("span", null, t("openInBrowser"), " \u2197")
                    ) : null,
                    React.createElement("strong", null, t(loginMethod === "github" ? "scanWithGitHub" : "scanWithZhihu")),
                    React.createElement("p", null, t("scanLoginHint")),
                    status?.serverUrl === void 0 ? null : React.createElement(
                      "p",
                      { className: "dshRemoteServiceAddress" },
                      t("currentServiceAddress"),
                      " ",
                      React.createElement("a", {
                        href: status.serverUrl,
                        target: "_blank",
                        rel: "noreferrer"
                      }, status.serverUrl)
                    ),
                    qrExpired ? React.createElement("button", {
                      type: "button",
                      disabled: busy,
                      onClick: () => setQrExpired(!1)
                    }, t("refreshQrCode")) : null
                  ) : React.createElement(
                    "div",
                    {
                      className: "dshRemoteClientLogin",
                      role: "tabpanel",
                      id: "dsh-remote-password-panel",
                      "aria-labelledby": "dsh-remote-password-tab"
                    },
                    React.createElement("input", {
                      type: "url",
                      value: loginServerUrl,
                      disabled: busy,
                      autoComplete: "url",
                      placeholder: t("serverUrl"),
                      "aria-label": t("serverUrl"),
                      onChange: (event) => setLoginServerUrl(event.target.value)
                    }),
                    React.createElement("input", {
                      type: "email",
                      value: email,
                      disabled: busy,
                      autoComplete: "username",
                      placeholder: t("account"),
                      "aria-label": t("account"),
                      onChange: (event) => setEmail(event.target.value)
                    }),
                    React.createElement("input", {
                      type: "password",
                      value: password,
                      disabled: busy,
                      autoComplete: "current-password",
                      placeholder: t("password"),
                      "aria-label": t("password"),
                      onChange: (event) => setPassword(event.target.value)
                    }),
                    React.createElement("button", { type: "button", disabled: busy || loginServerUrl.trim() === "" || email.trim() === "" || password === "", onClick: () => void signInClient() }, t(busy ? "signingIn" : "startSignIn"))
                  )
                ) : null,
                needsAuthorization ? null : React.createElement(
                  React.Fragment,
                  null,
                  selectedHost === void 0 ? React.createElement(
                    "section",
                    { className: "dshRemoteHosts", "aria-label": t("chooseHost") },
                    React.createElement(
                      "div",
                      { className: "dshRemoteSectionHeading" },
                      React.createElement(
                        "div",
                        { className: "dshRemoteSectionTitle" },
                        React.createElement("strong", null, t("chooseHost")),
                        status?.hostAuthorizationAvailable ? React.createElement(
                          "div",
                          { className: "dshRemoteHostControlToggle" },
                          React.createElement("span", null, t("allowControlDevice")),
                          React.createElement("input", {
                            type: "checkbox",
                            role: "switch",
                            disabled: busy,
                            "aria-label": t("allowControlDevice"),
                            checked: status.host?.authorized === !0,
                            onChange: (event) => void setCurrentDeviceControl(event.target.checked)
                          })
                        ) : null,
                        connectedMenu
                      )
                    ),
                    React.createElement("div", {
                      className: `dshRemoteHostList${connectingHost === void 0 ? "" : " isCollapsed"}`,
                      "aria-busy": connectingHost === void 0 ? void 0 : !0
                    }, listedHosts.length === 0 ? React.createElement("p", null, t(busy ? "checkingConnection" : "noRemoteHosts")) : listedHosts.map((device) => React.createElement(
                      "button",
                      {
                        type: "button",
                        key: device.deviceId,
                        disabled: busy || !device.online,
                        "aria-current": connectingHost?.deviceId === device.deviceId ? "true" : void 0,
                        onClick: () => void selectHost(device)
                      },
                      React.createElement(
                        "span",
                        null,
                        React.createElement("strong", null, device.name),
                        React.createElement("small", null, [
                          formatPlatform(device.platform),
                          device.harnessVersion === void 0 ? void 0 : t("harnessVersion", { version: device.harnessVersion }),
                          device.clientVersion === void 0 ? void 0 : t("pluginVersion", { version: device.clientVersion })
                        ].filter(Boolean).join(" \xB7 "))
                      ),
                      React.createElement("small", null, t(device.online ? "online" : "offline"))
                    )))
                  ) : null,
                  React.createElement(RemoteProgressView, { progress, t }),
                  selectedHost === void 0 ? connectingHost === void 0 ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement("p", { className: "dshRemoteHint" }, t("selectHostHint")),
                    React.createElement(
                      "footer",
                      { className: "dshRemoteAccountFooter" },
                      React.createElement("span", null, status?.host?.account ?? t("account")),
                      React.createElement("button", {
                        type: "button",
                        className: "dshRemoteAccountExit",
                        disabled: busy,
                        onClick: () => void logoutRemote()
                      }, t("exitRemoteAccount"))
                    )
                  ) : null : React.createElement(
                    "section",
                    { className: "dshRemoteBrowser", "aria-label": t("chooseDirectory") },
                    React.createElement(
                      "div",
                      { className: "dshRemoteSectionHeading dshRemoteWorkspaceHeading" },
                      React.createElement("strong", null, t(addingWorkspace ? workspaceBackend === "codex" ? "addCodexWorkspace" : workspaceBackend === "cursor" ? "addCursorWorkspace" : workspaceBackend === "antigravity" ? "addAntigravityWorkspace" : "addRemoteWorkspace" : "existingWorkspaces")),
                      addingWorkspace ? React.createElement("button", {
                        type: "button",
                        className: "dshRemoteCancelWorkspace",
                        disabled: busy,
                        onClick: cancelAddingWorkspace
                      }, t("cancelAddWorkspace")) : React.createElement("button", {
                        type: "button",
                        className: "dshRemoteAddWorkspace",
                        disabled: busy,
                        title: t("addRemoteWorkspace"),
                        "aria-label": t("addRemoteWorkspace"),
                        onClick: () => startAddingWorkspace("harness")
                      }, React.createElement("svg", {
                        className: "dshRemoteAddWorkspaceIcon",
                        viewBox: "0 0 16 16",
                        "aria-hidden": !0,
                        focusable: !1
                      }, React.createElement("path", { d: "M8 3v10M3 8h10", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })))
                    ),
                    addingWorkspace ? React.createElement(
                      "div",
                      { className: "dshRemoteFolderBrowser" },
                      directory === void 0 ? React.createElement("p", null, t("loadingDirectory")) : React.createElement(
                        React.Fragment,
                        null,
                        React.createElement(
                          "nav",
                          { className: "dshRemoteCrumbs", "aria-label": t("currentDirectory") },
                          directory.crumbs.map((crumb) => React.createElement("button", {
                            type: "button",
                            key: crumb.path,
                            disabled: busy || crumb.path === directory.path,
                            onClick: () => void browseDirectory(crumb.path)
                          }, crumb.path === directory.home ? "\u2302" : crumb.name))
                        ),
                        React.createElement("div", { className: "dshRemoteFolderList" }, directory.entries.filter((entry) => !entry.hidden).length === 0 ? React.createElement("p", null, t("emptyDirectory")) : directory.entries.filter((entry) => !entry.hidden).map((entry) => React.createElement("button", {
                          type: "button",
                          key: entry.path,
                          disabled: busy,
                          onClick: () => void browseDirectory(entry.path)
                        }, React.createElement("span", { "aria-hidden": !0 }, "\u25B1"), React.createElement("span", null, entry.name)))),
                        directory.truncated ? React.createElement("small", null, t("directoryTruncated")) : null
                      )
                    ) : React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(
                        "div",
                        { className: "dshRemoteWorkspaceLists" },
                        React.createElement(
                          "div",
                          { id: workspaceListId, className: "dshRemoteDirectoryList" },
                          workspaces.length === 0 ? React.createElement("p", null, t("noRemoteWorkspaces")) : visibleWorkspaces.map((workspace) => React.createElement(
                            "button",
                            {
                              type: "button",
                              key: workspace.workspaceId,
                              disabled: busy,
                              className: workspaceBackend === "harness" && path === workspace.path ? "isSelected" : "",
                              "aria-pressed": workspaceBackend === "harness" && path === workspace.path,
                              onClick: () => {
                                setWorkspaceBackend("harness"), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setPath(workspace.path);
                              },
                              onDoubleClick: () => void openWorkspace({ backend: "harness", path: workspace.path })
                            },
                            React.createElement("img", { className: "dshRemoteWorkspaceIcon", src: deepSeekWorkspaceIcon, alt: "", "aria-hidden": !0 }),
                            React.createElement("span", null, workspace.title),
                            React.createElement("small", null, workspace.path)
                          )),
                          workspaces.length <= 3 || showAllWorkspaces ? null : React.createElement("button", {
                            type: "button",
                            className: "dshRemoteWorkspaceMore",
                            disabled: busy,
                            "aria-controls": workspaceListId,
                            "aria-label": t("showAllWorkspaces"),
                            onClick: () => setShowAllWorkspaces(!0)
                          }, React.createElement("span", { "aria-hidden": !0 }, "\u2026"))
                        )
                      ),
                      codexAvailable ? React.createElement(
                        "section",
                        { className: "dshRemoteCodexWorkspaceGroup" },
                        React.createElement(
                          "div",
                          {
                            id: codexWorkspaceHeadingId,
                            className: "dshRemoteWorkspaceSourceHeading"
                          },
                          React.createElement(
                            "span",
                            { className: "dshRemoteWorkspaceSourceText" },
                            React.createElement("strong", null, t("codexVirtualWorkspace"))
                          ),
                          codexAvailable ? React.createElement("button", {
                            type: "button",
                            className: "dshRemoteAddWorkspace",
                            disabled: busy,
                            title: t("addCodexWorkspace"),
                            "aria-label": t("addCodexWorkspace"),
                            onClick: () => startAddingWorkspace("codex")
                          }, React.createElement("svg", {
                            className: "dshRemoteAddWorkspaceIcon",
                            viewBox: "0 0 16 16",
                            "aria-hidden": !0,
                            focusable: !1
                          }, React.createElement("path", { d: "M8 3v10M3 8h10", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }))) : null
                        ),
                        React.createElement("div", {
                          id: codexWorkspaceListId,
                          className: "dshRemoteDirectoryList dshRemoteCodexWorkspaceList",
                          "aria-labelledby": codexWorkspaceHeadingId
                        }, visibleCodexWorkspaces.length === 0 ? React.createElement("p", null, t("noCodexWorkspaces")) : visibleCodexWorkspaces.map((workspace) => React.createElement(
                          "button",
                          {
                            type: "button",
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === "codex" && codexWorkspaceId === workspace.workspaceId ? "isSelected" : "",
                            "aria-pressed": workspaceBackend === "codex" && codexWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend("codex"), setCodexWorkspaceId(workspace.workspaceId), setCursorWorkspaceId(void 0), setPath(workspace.path);
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: "codex",
                              path: workspace.path,
                              workspaceId: workspace.workspaceId
                            })
                          },
                          React.createElement("img", { className: "dshRemoteWorkspaceIcon isGpt", src: gptWorkspaceIcon, alt: "", "aria-hidden": !0 }),
                          React.createElement("span", null, workspace.title),
                          React.createElement("small", null, `${workspace.path} \xB7 ${workspace.sessionCount}`)
                        ))),
                        codexWorkspaces.length <= 3 || showAllCodexWorkspaces ? null : React.createElement("button", {
                          type: "button",
                          className: "dshRemoteWorkspaceMore",
                          disabled: busy,
                          "aria-controls": codexWorkspaceListId,
                          "aria-label": t("showAllCodexWorkspaces"),
                          onClick: () => setShowAllCodexWorkspaces(!0)
                        }, React.createElement("span", { "aria-hidden": !0 }, "\u2026"))
                      ) : null,
                      cursorAvailable ? React.createElement(
                        "section",
                        { className: "dshRemoteCodexWorkspaceGroup" },
                        React.createElement(
                          "div",
                          {
                            id: cursorWorkspaceHeadingId,
                            className: "dshRemoteWorkspaceSourceHeading"
                          },
                          React.createElement(
                            "span",
                            { className: "dshRemoteWorkspaceSourceText" },
                            React.createElement("strong", null, t("cursorVirtualWorkspace"))
                          ),
                          cursorAvailable ? React.createElement("button", {
                            type: "button",
                            className: "dshRemoteAddWorkspace",
                            disabled: busy,
                            title: t("addCursorWorkspace"),
                            "aria-label": t("addCursorWorkspace"),
                            onClick: () => startAddingWorkspace("cursor")
                          }, React.createElement("svg", {
                            className: "dshRemoteAddWorkspaceIcon",
                            viewBox: "0 0 16 16",
                            "aria-hidden": !0,
                            focusable: !1
                          }, React.createElement("path", { d: "M8 3v10M3 8h10", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }))) : null
                        ),
                        React.createElement("div", {
                          id: cursorWorkspaceListId,
                          className: "dshRemoteDirectoryList dshRemoteCodexWorkspaceList",
                          "aria-labelledby": cursorWorkspaceHeadingId
                        }, visibleCursorWorkspaces.length === 0 ? React.createElement("p", null, t("noCursorWorkspaces")) : visibleCursorWorkspaces.map((workspace) => React.createElement(
                          "button",
                          {
                            type: "button",
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === "cursor" && cursorWorkspaceId === workspace.workspaceId ? "isSelected" : "",
                            "aria-pressed": workspaceBackend === "cursor" && cursorWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend("cursor"), setCursorWorkspaceId(workspace.workspaceId), setCodexWorkspaceId(void 0), setAntigravityWorkspaceId(void 0), setPath(workspace.path);
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: "cursor",
                              path: workspace.path,
                              workspaceId: workspace.workspaceId
                            })
                          },
                          React.createElement("img", { className: "dshRemoteWorkspaceIcon", src: deepSeekWorkspaceIcon, alt: "", "aria-hidden": !0 }),
                          React.createElement("span", null, workspace.title),
                          React.createElement("small", null, `${workspace.path} \xB7 ${workspace.sessionCount}`)
                        ))),
                        cursorWorkspaces.length <= 3 || showAllCursorWorkspaces ? null : React.createElement("button", {
                          type: "button",
                          className: "dshRemoteWorkspaceMore",
                          disabled: busy,
                          "aria-controls": cursorWorkspaceListId,
                          "aria-label": t("showAllCursorWorkspaces"),
                          onClick: () => setShowAllCursorWorkspaces(!0)
                        }, React.createElement("span", { "aria-hidden": !0 }, "\u2026"))
                      ) : null,
                      antigravityAvailable ? React.createElement(
                        "section",
                        { className: "dshRemoteCodexWorkspaceGroup" },
                        React.createElement(
                          "div",
                          {
                            id: antigravityWorkspaceHeadingId,
                            className: "dshRemoteWorkspaceSourceHeading"
                          },
                          React.createElement(
                            "span",
                            { className: "dshRemoteWorkspaceSourceText" },
                            React.createElement("strong", null, t("antigravityVirtualWorkspace"))
                          ),
                          antigravityAvailable ? React.createElement("button", {
                            type: "button",
                            className: "dshRemoteAddWorkspace",
                            disabled: busy,
                            title: t("addAntigravityWorkspace"),
                            "aria-label": t("addAntigravityWorkspace"),
                            onClick: () => startAddingWorkspace("antigravity")
                          }, React.createElement("svg", {
                            className: "dshRemoteAddWorkspaceIcon",
                            viewBox: "0 0 16 16",
                            "aria-hidden": !0,
                            focusable: !1
                          }, React.createElement("path", { d: "M8 3v10M3 8h10", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }))) : null
                        ),
                        React.createElement("div", {
                          id: antigravityWorkspaceListId,
                          className: "dshRemoteDirectoryList dshRemoteCodexWorkspaceList",
                          "aria-labelledby": antigravityWorkspaceHeadingId
                        }, visibleAntigravityWorkspaces.length === 0 ? React.createElement("p", null, t("noAntigravityWorkspaces")) : visibleAntigravityWorkspaces.map((workspace) => React.createElement(
                          "button",
                          {
                            type: "button",
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === "antigravity" && antigravityWorkspaceId === workspace.workspaceId ? "isSelected" : "",
                            "aria-pressed": workspaceBackend === "antigravity" && antigravityWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend("antigravity"), setAntigravityWorkspaceId(workspace.workspaceId), setCodexWorkspaceId(void 0), setCursorWorkspaceId(void 0), setPath(workspace.path);
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: "antigravity",
                              path: workspace.path,
                              workspaceId: workspace.workspaceId
                            })
                          },
                          React.createElement("img", { className: "dshRemoteWorkspaceIcon", src: deepSeekWorkspaceIcon, alt: "", "aria-hidden": !0 }),
                          React.createElement("span", null, workspace.title),
                          React.createElement("small", null, `${workspace.path} \xB7 ${workspace.sessionCount}`)
                        ))),
                        antigravityWorkspaces.length <= 3 || showAllAntigravityWorkspaces ? null : React.createElement("button", {
                          type: "button",
                          className: "dshRemoteWorkspaceMore",
                          disabled: busy,
                          "aria-controls": antigravityWorkspaceListId,
                          "aria-label": t("showAllAntigravityWorkspaces"),
                          onClick: () => setShowAllAntigravityWorkspaces(!0)
                        }, React.createElement("span", { "aria-hidden": !0 }, "\u2026"))
                      ) : null
                    ),
                    React.createElement(
                      "footer",
                      { className: "dshRemoteOpenBar" },
                      React.createElement("div", null, React.createElement("span", null, t("currentDirectory")), React.createElement("strong", null, path || "\u2014")),
                      React.createElement("button", {
                        type: "button",
                        disabled: busy || path.trim() === "" || !addingWorkspace && workspaceBackend === "codex" && codexWorkspaceId === void 0 || !addingWorkspace && workspaceBackend === "cursor" && cursorWorkspaceId === void 0 && path === "" || !addingWorkspace && workspaceBackend === "antigravity" && antigravityWorkspaceId === void 0 && path === "",
                        onClick: () => void openWorkspace()
                      }, t(busy ? "openingWorkspace" : addingWorkspace ? "confirmAddWorkspace" : "openWorkspace"))
                    )
                  )
                )
              ),
              notice === void 0 ? null : React.createElement("p", { className: "dshRemoteNotice", role: "status" }, notice),
              error === void 0 ? null : React.createElement("p", { className: "dshRemoteError", role: "alert" }, error)
            )
          )) : null
        );
      }
      function RemoteModeAction(props) {
        let { t } = props, [open, setOpen] = React.useState(!1), [status, setStatus] = React.useState(void 0), [devices, setDevices] = React.useState([]), [hostRegistrationCode, setHostRegistrationCode] = React.useState(""), [email, setEmail] = React.useState(""), [password, setPassword] = React.useState(""), [busy, setBusy] = React.useState(!1), [progress, setProgress] = React.useState(void 0), progressRun = React.useRef(0), [error, setError] = React.useState(void 0), [supported, setSupported] = React.useState(!0), refresh = async () => {
          let [nextStatus, nextDevices] = await Promise.all([
            props.control("status"),
            props.control("devices").catch(() => [])
          ]);
          setStatus(nextStatus), setDevices(nextDevices);
        }, refreshStatus = async () => {
          setStatus(await props.control("status"));
        };
        React.useEffect(() => {
          refresh().catch((reason) => {
            setError(messageOf(reason)), setSupported(!1);
          });
        }, []), React.useEffect(() => {
          if (open)
            return props.statusFeed.subscribe(setStatus);
        }, [open]);
        let switchMode = async (mode, targetDeviceId) => {
          setBusy(!0), setError(void 0);
          try {
            let action = () => props.control("mode.set", { mode, ...targetDeviceId === void 0 ? {} : { targetDeviceId } });
            setStatus(mode === "remote" && targetDeviceId !== void 0 ? await runConnectHostProgress(
              status?.preferredTransports,
              targetDeviceId,
              props.control,
              { label: "remoteProgressSwitchingWorkspace", detail: "remoteProgressSwitchingWorkspaceDetail" },
              setProgress,
              progressRun,
              action,
              connectedProgress
            ) : await action()), window.location.reload();
          } catch (reason) {
            setError(messageOf(reason)), setBusy(!1);
          }
        }, loginHost = async () => {
          if (!(email.trim() === "" || password === "")) {
            setBusy(!0), setError(void 0);
            try {
              await props.control("host.account.login", { email: email.trim(), password }), await refreshStatus();
            } catch (reason) {
              setError(messageOf(reason));
            } finally {
              setPassword(""), setBusy(!1);
            }
          }
        }, registerHostWithCode = async () => {
          if (hostRegistrationCode.trim() !== "") {
            setBusy(!0), setError(void 0);
            try {
              await props.control("host.registration-code.submit", { code: hostRegistrationCode.trim() }), setHostRegistrationCode(""), await refreshStatus();
            } catch (reason) {
              setError(messageOf(reason));
            } finally {
              setBusy(!1);
            }
          }
        }, label = status?.mode === "remote" ? t("remoteTarget", { name: status.target?.name ?? t("host") }) : t("local");
        return supported ? React.createElement(
          React.Fragment,
          null,
          React.createElement("button", {
            type: "button",
            className: "dshRemoteModeButton",
            title: t("switchTarget"),
            "aria-label": t("switchTarget"),
            onClick: () => setOpen(!0)
          }, React.createElement("span", { "aria-hidden": !0 }, "\u25CE"), props.wide ? React.createElement("span", null, label) : null),
          open ? React.createElement(
            "div",
            { className: "dshRemoteBackdrop", role: "presentation" },
            React.createElement(
              "section",
              {
                className: "dshRemoteDialog",
                role: "dialog",
                "aria-modal": !0,
                "aria-label": t("harnessTarget")
              },
              React.createElement(
                "div",
                { className: "dshRemoteHeader" },
                React.createElement("strong", null, t("harnessTarget")),
                React.createElement("button", { type: "button", onClick: () => setOpen(!1), "aria-label": t("close") }, "\xD7")
              ),
              React.createElement("button", {
                type: "button",
                disabled: busy || status?.mode === "local",
                onClick: () => void switchMode("local")
              }, t("thisMachineLocal")),
              React.createElement("div", { className: "dshRemoteDevices" }, devices.length === 0 ? React.createElement("p", null, t("noRemoteHosts")) : devices.map((device) => React.createElement("button", {
                type: "button",
                key: device.deviceId,
                disabled: busy || !device.online || status?.target?.deviceId === device.deviceId,
                onClick: () => void switchMode("remote", device.deviceId)
              }, `${device.name} \xB7 ${t(device.online ? "online" : "offline")}`))),
              React.createElement(RemoteProgressView, { progress, t }),
              status?.hostAuthorizationAvailable && status.host !== void 0 ? React.createElement(
                "div",
                { className: "dshRemoteHostAccount" },
                React.createElement("strong", null, t("thisMachineHost")),
                React.createElement("p", null, status.host.online ? status.host.account === void 0 ? t("connected") : t("connectedAs", { account: status.host.account }) : status.host.accountRequired ? t("hostSignInHint") : status.host.error === void 0 ? t("checkingHost") : t("hostUnavailable", { error: connectionErrorMessage(status.host.error, t) })),
                status.host.accountRequired ? React.createElement(
                  "div",
                  { className: "dshRemoteLogin" },
                  React.createElement("input", {
                    type: "email",
                    value: email,
                    disabled: busy,
                    autoComplete: "username",
                    placeholder: t("serverAccountEmail"),
                    "aria-label": t("serverAccountEmail"),
                    onChange: (event) => setEmail(event.target.value)
                  }),
                  React.createElement("input", {
                    type: "password",
                    value: password,
                    disabled: busy,
                    autoComplete: "current-password",
                    placeholder: t("password"),
                    "aria-label": t("serverAccountPassword"),
                    onChange: (event) => setPassword(event.target.value)
                  }),
                  React.createElement("button", {
                    type: "button",
                    disabled: busy || email.trim() === "" || password === "",
                    onClick: () => void loginHost()
                  }, t(busy ? "signingIn" : "signInRegisterHost")),
                  React.createElement("input", {
                    value: hostRegistrationCode,
                    disabled: busy,
                    autoComplete: "one-time-code",
                    placeholder: t("hostRegistrationCode"),
                    "aria-label": t("hostRegistrationCode"),
                    onChange: (event) => setHostRegistrationCode(event.target.value)
                  }),
                  React.createElement("button", {
                    type: "button",
                    disabled: busy || hostRegistrationCode.trim() === "",
                    onClick: () => void registerHostWithCode()
                  }, t(busy ? "registering" : "useRegistrationCode"))
                ) : null
              ) : null,
              error === void 0 ? null : React.createElement("p", { className: "dshRemoteError", role: "alert" }, error)
            )
          ) : null
        ) : null;
      }
      function RemoteSessionHeaderAction(props) {
        let { t } = props, status = React.useSyncExternalStore(
          props.statusFeed.subscribe,
          props.statusFeed.getSnapshot,
          props.statusFeed.getSnapshot
        ), [busy, setBusy] = React.useState(!1), [routeOpen, setRouteOpen] = React.useState(!1);
        if (React.useEffect(() => {
          if (status?.mode === "remote")
            return hideLocalSessionActions();
        }, [status?.mode]), React.useEffect(() => (document.documentElement.classList.toggle(
          "dshRemoteCodexTargetActive",
          status?.mode === "remote" && status.backend === "codex"
        ), document.documentElement.classList.toggle(
          "dshRemoteCursorTargetActive",
          status?.mode === "remote" && status.backend === "cursor"
        ), document.documentElement.classList.toggle(
          "dshRemoteAntigravityTargetActive",
          status?.mode === "remote" && status.backend === "antigravity"
        ), () => {
          document.documentElement.classList.remove("dshRemoteCodexTargetActive"), document.documentElement.classList.remove("dshRemoteCursorTargetActive"), document.documentElement.classList.remove("dshRemoteAntigravityTargetActive");
        }), [status?.mode, status?.backend]), React.useEffect(() => {
          if (!routeOpen) return;
          let closeOnEscape = (event) => {
            event.key === "Escape" && setRouteOpen(!1);
          };
          return document.addEventListener("keydown", closeOnEscape), () => document.removeEventListener("keydown", closeOnEscape);
        }, [routeOpen]), status?.mode !== "remote") return null;
        let exit = async () => {
          setBusy(!0);
          try {
            await props.control("mode.set", { mode: "local" }), window.location.reload();
          } finally {
            setBusy(!1);
          }
        }, transport = status.network?.webRtc?.mode ?? status.transport ?? "Disconnected", networkLabel = t(transport === "P2P" ? "remoteNetworkP2p" : transport === "TURN" ? "remoteNetworkTurn" : transport === "Relay" ? "remoteNetworkRelay" : transport === "LAN" ? "remoteNetworkLan" : "remoteNetworkOffline"), networkOnline = status.connected === !0 && transport !== "Disconnected", routeVia = t(transport === "P2P" ? "connectionRouteP2p" : transport === "TURN" ? "connectionRouteTurn" : transport === "Relay" ? "connectionRouteRelay" : "connectionRouteLan"), routeViaDetail = t(transport === "P2P" ? "connectionRouteP2pDetail" : transport === "TURN" ? "connectionRouteTurnDetail" : transport === "Relay" ? "connectionRouteRelayDetail" : "connectionRouteLanDetail"), network = status.network, webRtc = network?.webRtc, controlStateLabel = network?.controlChannelState === "connecting" ? t("controlStateConnecting") : network?.controlChannelState === "open" ? t("controlStateOpen") : network?.controlChannelState === "closing" ? t("controlStateClosing") : t("controlStateClosed"), detailValue = (value) => value === void 0 || value === "" ? t("notProvided") : String(value), candidateLabel = (value) => value === "host" ? t("candidateHost") : value === "srflx" ? t("candidateSrflx") : value === "prflx" ? t("candidatePrflx") : value === "relay" ? t("candidateRelay") : detailValue(value), fact = (label, value, mono = !1) => React.createElement(
          "div",
          null,
          React.createElement("dt", null, label),
          React.createElement("dd", { className: mono ? "isMono" : void 0, title: mono ? value : void 0 }, value)
        );
        return React.createElement(
          "div",
          { className: "dshRemoteSessionHeader", role: "status" },
          React.createElement("svg", {
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.7,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": !0
          }, React.createElement("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }), React.createElement("path", { d: "M8 21h8M12 17v4" })),
          React.createElement("span", { className: "dshRemoteSessionTarget" }, t("remoteModeLabel", { name: status.target?.name ?? t("host") })),
          React.createElement("button", {
            type: "button",
            className: `dshRemoteNetwork${networkOnline ? " isOnline" : " isOffline"}`,
            title: networkLabel,
            disabled: !networkOnline,
            "aria-haspopup": "dialog",
            "aria-expanded": routeOpen,
            onClick: () => setRouteOpen((value) => !value)
          }, React.createElement("i", { "aria-hidden": !0 }), networkLabel),
          networkOnline ? React.createElement("span", { className: "dshRemoteEncrypted" }, t("remoteLinkEncrypted")) : null,
          React.createElement("button", { type: "button", className: "dshRemoteHeaderExitLink", disabled: busy, onClick: () => void exit() }, t("exitRemote")),
          routeOpen ? React.createElement("div", {
            className: "dshRemoteRouteBackdrop",
            role: "presentation",
            onMouseDown: (event) => {
              event.target === event.currentTarget && setRouteOpen(!1);
            }
          }, React.createElement(
            "section",
            {
              className: "dshRemoteRoutePanel",
              role: "dialog",
              "aria-label": t("connectionRouteTitle")
            },
            React.createElement(
              "header",
              null,
              React.createElement("strong", null, t("connectionRouteTitle")),
              React.createElement("button", { type: "button", "aria-label": t("close"), onClick: () => setRouteOpen(!1) }, "\xD7")
            ),
            React.createElement(
              "ol",
              null,
              React.createElement(
                "li",
                null,
                React.createElement("small", null, t("connectionRouteFrom")),
                React.createElement("strong", null, network?.local.name ?? t("connectionRouteCurrentDevice")),
                network === void 0 ? null : React.createElement("span", null, `${network.local.platform} \xB7 ${shortDeviceId(network.local.deviceId)}`)
              ),
              React.createElement(
                "li",
                null,
                React.createElement("small", null, t("connectionRouteVia")),
                React.createElement("strong", null, routeVia),
                React.createElement("span", null, routeViaDetail)
              ),
              React.createElement(
                "li",
                null,
                React.createElement("small", null, t("connectionRouteTo")),
                React.createElement("strong", null, network?.remote.name ?? status.target?.name ?? t("host")),
                React.createElement("span", null, network === void 0 ? t("connectionRouteHost") : `${network.remote.platform} \xB7 ${shortDeviceId(network.remote.deviceId)}`)
              )
            ),
            network === void 0 ? null : React.createElement(
              "section",
              { className: "dshRemoteRouteSection" },
              React.createElement("h3", null, t("connectionDetailsConnection")),
              React.createElement(
                "dl",
                null,
                fact(t("connectionId"), detailValue(network.connectionId), !0),
                fact(t("connectedAt"), network.connectedAt === void 0 ? t("notProvided") : formatLocalTime(network.connectedAt)),
                fact(t("preferredTransports"), network.preferredTransports.map((value) => transportLabel(value, t)).join(" \u2192 ")),
                fact(t("controlChannel"), `WebSocket \xB7 ${controlStateLabel}`),
                fact(t("controlAddress"), network.controlChannelUrl, !0)
              )
            ),
            webRtc === void 0 ? null : React.createElement(
              "section",
              { className: "dshRemoteRouteSection" },
              React.createElement("h3", null, t("connectionDetailsWebRtc")),
              React.createElement(
                "dl",
                null,
                fact(t("peerState"), `${webRtc.connectionState} \xB7 ICE ${webRtc.iceConnectionState}`),
                fact(t("dataChannel"), detailValue(webRtc.dataChannelState)),
                fact(t("localCandidate"), candidateLabel(webRtc.localCandidateType)),
                fact(t("remoteCandidate"), candidateLabel(webRtc.remoteCandidateType)),
                fact(t("localAddress"), detailValue(webRtc.localAddress), !0),
                fact(t("remoteAddress"), detailValue(webRtc.remoteAddress), !0),
                fact(t("networkProtocol"), detailValue(webRtc.protocol?.toUpperCase())),
                fact(t("relayProtocol"), detailValue(webRtc.relayProtocol?.toUpperCase())),
                fact(t("roundTripTime"), webRtc.currentRoundTripTimeMs === void 0 ? t("notProvided") : `${webRtc.currentRoundTripTimeMs.toLocaleString()} ms`),
                fact(t("availableBitrate"), webRtc.availableOutgoingBitrate === void 0 ? t("notProvided") : formatBitrate(webRtc.availableOutgoingBitrate)),
                fact(t("bytesSent"), webRtc.bytesSent === void 0 ? t("notProvided") : formatByteSize(webRtc.bytesSent)),
                fact(t("bytesReceived"), webRtc.bytesReceived === void 0 ? t("notProvided") : formatByteSize(webRtc.bytesReceived))
              )
            ),
            React.createElement("p", null, t("connectionRouteEncrypted"))
          )) : null
        );
      }
      function hideLocalSessionActions() {
        let selector = 'button,a,[role="button"]', hiddenAttribute = "data-dsh-remote-hidden-action", localAction = /(?:open|打开).{0,12}vs\s*code|vs\s*code.{0,12}(?:open|打开)|session\s*logs?|download.{0,12}session\s*logs?|会话日志|下载.{0,8}日志/i, inspect = (root) => {
          let candidates = root instanceof Element && root.matches(selector) ? [root, ...Array.from(root.querySelectorAll(selector))] : Array.from(root.querySelectorAll(selector));
          for (let candidate of candidates) {
            if (candidate.closest(".dshRemoteSessionHeader") !== null) continue;
            let label = [
              candidate.getAttribute("aria-label"),
              candidate.getAttribute("title"),
              candidate.getAttribute("data-tooltip"),
              candidate.textContent
            ].filter(Boolean).join(" ");
            localAction.test(label) && candidate.setAttribute(hiddenAttribute, "");
          }
        };
        inspect(document.body);
        let observer = new MutationObserver((records) => {
          for (let record of records) {
            record.type === "attributes" && inspect(record.target);
            for (let node of Array.from(record.addedNodes))
              node instanceof Element && inspect(node);
          }
        });
        return observer.observe(document.body, {
          subtree: !0,
          childList: !0,
          attributes: !0,
          attributeFilter: ["aria-label", "title", "data-tooltip"]
        }), () => {
          observer.disconnect(), document.querySelectorAll(`[${hiddenAttribute}]`).forEach((element) => element.removeAttribute(hiddenAttribute));
        };
      }
      function installStyle() {
        let style = document.createElement("style");
        return style.dataset.plugin = clientModuleId, style.dataset.pluginCss = "dsh-remote", style.textContent = [
          'html.dshRemoteTargetActive button[aria-label="\u6DFB\u52A0\u5DE5\u4F5C\u533A"],html.dshRemoteTargetActive button[aria-label="Add workspace"]{display:none!important}',
          'html.dshRemoteCodexTargetActive [data-composer-card] button[aria-haspopup="listbox"][aria-label="\u6307\u4EE4"],html.dshRemoteCodexTargetActive [data-composer-card] button[aria-haspopup="listbox"][aria-label="Commands"]{display:none!important}',
          "[data-dsh-remote-hidden-action]{display:none!important}",
          // The 0.1.6 right sidebar occupies the same shell header area as the
          // remote status strip. Hide the strip while that sidebar is expanded;
          // the sidebar itself remains the active context for terminal/files.
          ":has([data-sidebar-right-open]) .dshRemoteSessionHeader{display:none!important}",
          // TerminalRecovery renders a retry action in the conversation header.
          // A failed remote terminal is reported when its tab is opened/closed;
          // keeping this background recovery action out of the top-left header
          // avoids overlapping the session controls.
          '[title^="\u6062\u590D\u7EC8\u7AEF\u5931\u8D25"],[title^="Terminal recovery failed"]{display:none!important}',
          ".dshRemoteTerminalUnavailable{box-sizing:border-box;margin:12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.5}",
          ".dshRemoteModeButton{min-height:36px;border:0;background:transparent;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;padding:0 10px;border-radius:8px}.dshRemoteModeButton:is(button){cursor:pointer}",
          ".dshRemoteModeButton:is(button):hover{background:var(--dsw-alias-interactive-bg-hover)}",
          ".dshRemoteSidebarEntry{box-sizing:border-box;position:relative;min-width:0;display:block;overflow:hidden}.dshRemoteSidebarEntry .dshRemoteModeButton{box-sizing:border-box;width:100%;min-width:0}.dshRemoteSidebarEntry.isWide{width:calc(100% + 8px);height:34px;margin:4px -4px}.dshRemoteSidebarEntry.isWide .dshRemoteModeButton{height:34px;min-height:34px;padding:6px 48px 6px 10px;border-radius:12px}.dshRemoteSidebarEntry.isRail{width:36px;height:54px}.dshRemoteSidebarEntry.isRail .dshRemoteModeButton{width:36px;height:36px;min-height:36px;justify-content:center;gap:0;margin:8px 0 10px;padding:0;border-radius:50%}.dshRemoteSidebarEntry.isActive .dshRemoteModeButton{color:var(--dsw-alias-label-secondary);background:transparent}.dshRemoteSidebarLabel{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteExitLink{position:absolute;top:50%;right:10px;transform:translateY(-50%);white-space:nowrap;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;font:inherit;font-size:12px;line-height:20px;cursor:pointer}.dshRemoteExitLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteExitLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:2px}.dshRemoteExitLink:disabled{opacity:.45;cursor:default;text-decoration:none}",
          ".dshRemoteComputerIcon{box-sizing:border-box;width:18px;height:18px;flex:0 0 18px;color:var(--dsw-alias-label-secondary)}",
          '.dshRemoteSessionHeader{position:fixed;z-index:25;top:12px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 360px);height:28px;display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}.dshRemoteSessionHeader>svg{width:15px;height:15px;flex:0 0 auto}.dshRemoteSessionTarget{min-width:0;max-width:260px;overflow:hidden;text-overflow:ellipsis}.dshRemoteNetwork{flex:0 0 auto;border:0;background:transparent;color:inherit;font:inherit;padding:3px 2px;display:inline-flex;align-items:center;gap:5px;cursor:pointer}.dshRemoteNetwork:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteNetwork:disabled{cursor:default}.dshRemoteNetwork>i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.dshRemoteNetwork.isOnline>i{background:var(--dsw-alias-state-success-primary)}.dshRemoteNetwork.isOffline{color:var(--dsw-alias-state-error-primary)}.dshRemoteNetwork.isOffline>i{background:currentColor}.dshRemoteEncrypted{flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}.dshRemoteHeaderExitLink{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:3px 2px;font:inherit;text-decoration:none;cursor:pointer}.dshRemoteHeaderExitLink:hover{text-decoration:underline;color:var(--dsw-alias-label-primary)}.dshRemoteHeaderExitLink:disabled{opacity:.45;cursor:default;text-decoration:none}.dshRemoteNetwork:focus-visible,.dshRemoteHeaderExitLink:focus-visible,.dshRemoteRoutePanel>header button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshRemoteRouteBackdrop{position:fixed;inset:0;z-index:26}.dshRemoteRoutePanel{box-sizing:border-box;position:absolute;top:48px;right:28px;width:min(680px,calc(100vw - 32px));max-height:calc(100vh - 72px);overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;white-space:normal}.dshRemoteRoutePanel>header{position:sticky;top:-16px;z-index:1;display:flex;align-items:center;justify-content:space-between;margin:-16px -16px 0;padding:16px;background:var(--dsw-alias-bg-layer-1)}.dshRemoteRoutePanel>header strong{font-size:14px}.dshRemoteRoutePanel>header button{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:inherit;font-size:20px;cursor:pointer}.dshRemoteRoutePanel>header button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteRoutePanel ol{display:flex;align-items:stretch;margin:12px 0 0;padding:0 0 16px;border-bottom:1px solid var(--dsw-alias-border-l2);list-style:none}.dshRemoteRoutePanel li{position:relative;min-width:0;flex:1;display:flex;flex-direction:column;gap:4px;padding-right:20px}.dshRemoteRoutePanel li:not(:last-child)::after{content:"\u2192";position:absolute;right:7px;top:21px;color:var(--dsw-alias-label-tertiary)}.dshRemoteRoutePanel li small{color:var(--dsw-alias-label-tertiary)}.dshRemoteRoutePanel li strong,.dshRemoteRoutePanel li span{overflow:hidden;text-overflow:ellipsis}.dshRemoteRoutePanel li strong{font-size:13px}.dshRemoteRoutePanel li span{color:var(--dsw-alias-label-secondary);font-size:11px}.dshRemoteRouteSection{padding-top:16px}.dshRemoteRouteSection h3{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}.dshRemoteRouteSection dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px;margin:0}.dshRemoteRouteSection dl>div{min-width:0;display:grid;grid-template-columns:minmax(104px,auto) minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:1.45}.dshRemoteRouteSection dt{color:var(--dsw-alias-label-tertiary)}.dshRemoteRouteSection dd{min-width:0;margin:0;text-align:right;overflow-wrap:anywhere}.dshRemoteRouteSection dd.isMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}.dshRemoteRoutePanel>p{margin:16px 0 0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}@media(max-width:620px){.dshRemoteSessionHeader{top:8px;max-width:calc(100vw - 112px)}.dshRemoteSessionHeader>svg{display:none}.dshRemoteSessionTarget{max-width:130px}.dshRemoteEncrypted{display:none}.dshRemoteRoutePanel{top:42px;right:12px;max-height:calc(100vh - 56px)}.dshRemoteRoutePanel ol{flex-direction:column;gap:18px}.dshRemoteRoutePanel li:not(:last-child)::after{content:"\u2193";top:auto;right:auto;bottom:-16px;left:3px}.dshRemoteRouteSection dl{grid-template-columns:1fr}.dshRemoteRouteSection dl>div{grid-template-columns:1fr;gap:2px}.dshRemoteRouteSection dd{text-align:left}}',
          ".dshRemoteSessionHeader{left:auto;right:148px;transform:none;max-width:calc(100vw - 420px)}@media(max-width:760px){.dshRemoteSessionHeader{left:auto;right:104px;transform:none;max-width:calc(100vw - 124px)}}",
          ".dshRemoteModeButton:focus-visible,.dshRemotePage button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}",
          ".dshRemotePage{width:min(720px,100%);max-height:min(760px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:14px;overflow:hidden;animation:dshRemotePageIn .18s cubic-bezier(.25,1,.5,1)}",
          ".dshRemotePageHeader{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dshRemotePageIntro{min-width:0;flex:1}.dshRemotePageHeader strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px;line-height:1.4}.dshRemotePageHeader p{min-width:0;max-width:70ch;margin:3px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.dshRemotePageActions{flex:0 0 auto;display:flex;align-items:center;gap:4px}.dshRemotePageActions>button{height:40px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border:0;border-radius:8px;background:transparent;color:inherit;line-height:1;cursor:pointer}.dshRemotePageActions>button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshRemotePageActions>button:disabled{opacity:.45;cursor:default}.dshRemotePageBack,.dshRemotePageRefresh{min-width:48px;padding:0 10px;font:inherit;font-size:13px}.dshRemotePageBack{color:var(--dsw-alias-label-secondary)!important}.dshRemotePageClose{width:40px;padding:0;font-size:24px}",
          ".dshRemotePageBody{padding:24px;overflow:auto;display:flex;flex-direction:column;gap:24px}.dshRemotePageBody button{font:inherit;color:inherit}",
          ".dshRemotePageTitleRow{display:flex;align-items:center;gap:10px;min-width:0}.dshRemotePageTitleRow>strong{min-width:0;flex:0 1 auto}.dshRemoteStarLink{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;text-decoration:none}.dshRemoteStarLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:3px}.dshRemoteStarLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:3px}",
          ".dshRemoteSectionHeading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px}.dshRemoteSectionTitle{min-width:0;display:flex;align-items:center;gap:10px}.dshRemoteSectionTitle>strong{font-size:14px}.dshRemoteSectionActions{display:flex;align-items:center;gap:14px}.dshRemoteSectionActions>button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px 0;font-size:12px}.dshRemoteSectionActions>button:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}",
          ".dshRemoteSectionTitle{flex:1}.dshRemoteSectionTitle>.dshRemoteConnectedMenu{margin-left:auto}",
          '.dshRemoteAcpSetting{display:block!important;width:100%;padding:0}.dshRemoteAcpSetting>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;cursor:pointer;list-style:none}.dshRemoteAcpSetting>summary::-webkit-details-marker{display:none}.dshRemoteAcpSetting>summary::after{content:"\u2304";color:var(--dsw-alias-label-secondary);transition:transform .18s ease-out}.dshRemoteAcpSetting[open]>summary::after{transform:rotate(180deg)}.dshRemoteAcpSummaryText{min-width:0}.dshRemoteAcpSummaryText strong{display:block}.dshRemoteAcpSummaryText p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}.dshRemoteAcpCheckLink{grid-column:2;grid-row:1;color:var(--dsw-alias-brand-primary);font-size:12px;text-decoration:underline;text-underline-offset:3px}.dshRemoteAcpCheckLink:hover{color:var(--dsw-alias-label-primary)}.dshRemoteAcpCheckResult{grid-column:3;grid-row:1;font-size:11px;line-height:1.4;white-space:nowrap}.dshRemoteAcpCheckResult.isPassed{color:var(--dsw-alias-state-success-primary)}.dshRemoteAcpCheckResult.isFailed{color:var(--dsw-alias-state-danger-primary)}.dshRemoteAcpList{display:flex;flex-direction:column;gap:0;margin-top:12px;padding-top:0;border-top:0}.dshRemoteAcpList>.dshRemoteAuthorizationSetting{display:grid;width:100%;grid-template-columns:minmax(0,1fr) auto auto auto auto;align-items:center;column-gap:18px;line-height:1.4}.dshRemoteAcpList>.dshRemoteAuthorizationSetting>span:first-child{min-width:0;line-height:1.4}.dshRemoteAcpList>.dshRemoteAuthorizationSetting>input{grid-column:4;grid-row:1}',
          ".dshRemoteAcpAddLink{align-self:flex-start;margin-top:12px;color:var(--dsw-alias-brand-primary);font-size:12px;text-decoration:underline;text-underline-offset:3px}.dshRemoteAcpAddForm{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(140px,1fr) minmax(100px,1fr) auto;gap:8px;margin-top:12px}.dshRemoteAcpAddForm input{min-width:0;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;padding:0 10px}.dshRemoteAcpAddForm button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);padding:0 12px;cursor:pointer;font:inherit;font-size:12px}.dshRemoteAcpAddForm button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteAcpRemoveLink{grid-column:3;grid-row:1;color:var(--dsw-alias-label-secondary);font-size:12px;text-decoration:underline;text-underline-offset:3px}.dshRemoteAcpRemoveLink:hover{color:var(--dsw-alias-state-danger-primary)}",
          ".dshRemoteAcpCheckResult.isPassed,.dshRemoteAcpCheckResult.isFailed{color:var(--dsw-alias-label-secondary)}",
          ".dshRemoteAcpList>.dshRemoteAuthorizationSetting{grid-template-columns:minmax(0,1fr) 190px 40px 56px;column-gap:18px}.dshRemoteAcpCheckCell{grid-column:2;display:flex;align-items:center;gap:10px;min-width:0}.dshRemoteAcpCheckLink,.dshRemoteAcpRemoveLink{justify-self:start}.dshRemoteAcpCheckResult{position:static}",
          ".dshRemoteAcpCheckLink.isPassed{color:var(--dsw-alias-state-success-primary)}.dshRemoteAcpCheckLink.isFailed{color:var(--dsw-alias-state-danger-primary)}.dshRemoteAcpCheckLink.isChecking{color:var(--dsw-alias-label-secondary)}",
          ".dshRemoteCancelWorkspace{min-height:36px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 0;cursor:pointer}.dshRemoteCancelWorkspace:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteCancelWorkspace:disabled{opacity:.5;cursor:default}",
          '.dshRemoteHostList{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2);max-height:296px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.dshRemoteHostList.isCollapsed{max-height:none;overflow-y:visible}.dshRemoteHostList>button{min-height:58px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;padding:10px 4px;cursor:pointer}.dshRemoteHostList>button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteHostList>button:disabled{opacity:.5;cursor:default}.dshRemoteHostList>button[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteHostList>button>span{min-width:0;display:flex;flex-direction:column;gap:3px}.dshRemoteHostList>button strong{font-size:14px;font-weight:500}.dshRemoteHostList small{color:var(--dsw-alias-label-secondary);font-size:12px}',
          '.dshRemoteConnectedMenu{position:relative;flex:0 0 auto;margin-right:4px}.dshRemoteConnectedCount{appearance:none;display:inline-flex;align-items:center;justify-content:center;height:22px;border:0;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);box-shadow:0 1px 2px rgba(0,0,0,.18),0 0 0 1px rgba(255,255,255,.04) inset;padding:0 10px;font:inherit;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap;cursor:default}.dshRemoteConnectedCount.isOnline{color:var(--dsw-alias-state-success-primary)}.dshRemoteConnectedCount.isInteractive{cursor:pointer}.dshRemoteConnectedCount.isInteractive:hover{filter:brightness(1.08)}.dshRemoteConnectedCount:disabled{opacity:1;cursor:default}.dshRemoteConnectedCount:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshRemoteConnectedPanel{position:absolute;top:calc(100% + 8px);right:0;z-index:4;width:min(320px,calc(100vw - 48px));max-height:min(280px,40vh);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 28px rgba(0,0,0,.28);padding:10px 12px}.dshRemoteConnectedPanelTitle{display:block;margin:0 0 6px;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}.dshRemoteClientList{display:flex;flex-direction:column}.dshRemoteClientRow{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dshRemoteClientRow:last-child{border-bottom:0}.dshRemoteClientRow>span{min-width:0;display:flex;flex-direction:column;gap:2px}.dshRemoteClientRow strong{font-size:13px;font-weight:500}.dshRemoteClientRow small{color:var(--dsw-alias-label-secondary);font-size:11px}.dshRemoteClientOnline{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-state-success-primary)!important}.dshRemoteClientOnline::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}',
          ".dshRemoteConnectedCount{height:auto;border-radius:0;background:transparent;box-shadow:none;padding:0 4px;text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 45%,transparent);text-underline-offset:3px}.dshRemoteConnectedCount.isInteractive:hover{filter:none;text-decoration-color:currentColor}.dshRemoteConnectedCount:focus-visible{outline-offset:3px;border-radius:3px}",
          '.dshRemoteProgress{display:flex;flex-direction:column;gap:8px;margin:12px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dshRemoteProgressHeader{display:flex;align-items:center;justify-content:space-between;gap:12px}.dshRemoteProgressHeader strong{font-size:13px;font-weight:600}.dshRemoteProgressHeader span{color:var(--dsw-alias-label-secondary);font-size:12px}.dshRemoteProgressBar{height:6px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-bg-layer-3)}.dshRemoteProgressBar>span{display:block;width:100%;height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary);transform-origin:left center;transition:transform .22s ease-out}[dir="rtl"] .dshRemoteProgressBar>span{transform-origin:right center}.dshRemoteProgress p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dshRemoteProgressRoute{font-weight:500}.dshRemoteProgressRoute .isActive{color:var(--dsw-alias-state-success-primary);font-weight:700}.dshRemoteProgressRouteArrow{color:var(--dsw-alias-label-tertiary)}@media(prefers-reduced-motion:reduce){.dshRemoteProgressBar>span{transition:none}}',
          '.dshRemoteBrowser{display:flex;flex-direction:column}.dshRemoteCrumbs{display:flex;align-items:center;gap:4px;overflow:auto;padding:2px 0 10px}.dshRemoteCrumbs>button{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 7px;border-radius:6px;cursor:pointer}.dshRemoteCrumbs>button:not(:last-child)::after{content:" /";color:var(--dsw-alias-label-tertiary)}.dshRemoteCrumbs>button:disabled{color:var(--dsw-alias-label-primary);font-weight:600}',
          ".dshRemoteWorkspaceLists{overflow:visible}",
          ".dshRemoteDirectoryList{min-height:72px;display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}.dshRemoteDirectoryList>button{min-height:52px;display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px;text-align:left;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;padding:8px 4px;cursor:pointer}.dshRemoteDirectoryList>button:hover,.dshRemoteDirectoryList>button.isSelected{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteDirectoryList>button.isSelected{color:var(--dsw-alias-label-primary)}.dshRemoteDirectoryList>button>span:first-child,.dshRemoteDirectoryList>button>.dshRemoteWorkspaceIcon{grid-row:1/3}.dshRemoteWorkspaceIcon{box-sizing:border-box;width:22px;height:22px;align-self:center;object-fit:contain}.dshRemoteWorkspaceIcon.isGpt{border-radius:6px}.dshRemoteDirectoryList>button>span:not(:first-child),.dshRemoteDirectoryList>button>small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteDirectoryList>button>small{grid-column:2;color:var(--dsw-alias-label-secondary)}.dshRemoteDirectoryList>p,.dshRemoteHint{margin:12px 0;color:var(--dsw-alias-label-secondary);font-size:13px}",
          ".dshRemoteAddWorkspace{box-sizing:border-box;width:40px;height:40px;display:inline-grid;place-items:center;flex:0 0 auto;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;cursor:pointer}.dshRemoteAddWorkspace:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteAddWorkspace:disabled{opacity:.5;cursor:default}.dshRemoteAddWorkspaceIcon{width:20px;height:20px}.dshRemoteCodexWorkspaceGroup{margin-top:16px}.dshRemoteWorkspaceSourceHeading{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 4px 7px}.dshRemoteWorkspaceSourceText{min-width:0;display:flex;flex-direction:column;gap:2px}.dshRemoteWorkspaceSourceText>strong{font-size:13px}.dshRemoteWorkspaceSourceText>small{color:var(--dsw-alias-label-secondary);font-size:11px}.dshRemoteCodexWorkspaceList{min-height:0}.dshRemoteDirectoryList>.dshRemoteWorkspaceMore,.dshRemoteCodexWorkspaceGroup>.dshRemoteWorkspaceMore{box-sizing:border-box;width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);padding:8px 4px;text-align:center;font-size:16px;cursor:pointer}.dshRemoteWorkspaceMore>span{display:block;line-height:1;transform:translateY(-2px)}.dshRemoteWorkspaceMore:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:transparent}.dshRemoteWorkspaceMore:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dshRemoteWorkspaceMore:disabled{opacity:.5;cursor:default}",
          ".dshRemotePreviewAction,.dshRemotePreviewForm{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}.dshRemotePreviewForm input{width:90px;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);padding:6px}.dshRemotePreviewForm [role=alert]{max-width:360px;white-space:normal}.dshRemoteDevelopmentSettings{margin:16px 0}.dshRemoteDevelopmentSettings .dshRemotePathField{margin:8px 0}.dshRemoteDevelopmentSettings .dshRemotePortsRow{display:flex;gap:8px;align-items:stretch}.dshRemoteDevelopmentSettings .dshRemotePortsRow>input{flex:1;min-width:0;min-height:40px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:inherit;padding:0 12px;font:inherit}.dshRemoteDevelopmentSettings button{min-height:36px;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 12px;white-space:nowrap}",
          ".dshRemoteFolderBrowser{margin-top:14px}.dshRemoteFolderBrowser>p,.dshRemoteFolderList>p{margin:12px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.dshRemoteFolderList{max-height:260px;overflow:auto;border-block:1px solid var(--dsw-alias-border-l2)}.dshRemoteFolderList>button{width:100%;min-height:42px;display:flex;align-items:center;gap:9px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;padding:7px 6px;text-align:left;cursor:pointer}.dshRemoteFolderList>button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteFolderBrowser>small{display:block;margin-top:8px;color:var(--dsw-alias-state-warn-label)}",
          ".dshRemotePathField{display:flex;flex-direction:column;gap:6px;margin-top:20px}.dshRemotePathField>span{font-size:13px;font-weight:600}.dshRemotePathField>input{min-height:40px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:inherit;padding:0 12px;font:inherit}.dshRemotePathField>small{color:var(--dsw-alias-label-secondary)}",
          ".dshRemoteOpenBar{position:sticky;bottom:-96px;display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:20px;padding:14px 0;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l2)}.dshRemoteOpenBar>div{min-width:0;display:flex;flex-direction:column;gap:3px}.dshRemoteOpenBar span{color:var(--dsw-alias-label-secondary);font-size:12px}.dshRemoteOpenBar strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.dshRemoteOpenBar>button,.dshRemoteEnable>button{min-height:40px;flex:0 0 auto;border:0;border-radius:8px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);padding:8px 16px;cursor:pointer}.dshRemoteOpenBar>button:disabled,.dshRemoteEnable>button:disabled{opacity:.5;cursor:default}",
          ".dshRemoteEnable{box-sizing:border-box;width:min(440px,100%);max-width:100%;min-height:388px;margin:0 auto;display:flex;flex-direction:column;align-items:stretch;gap:10px}.dshRemoteEnable p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}",
          '.dshRemoteLoginTabs{width:min(440px,100%);display:flex;border-bottom:1px solid var(--dsw-alias-border-l2)}.dshRemoteLoginTabs>button{position:relative;min-height:38px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}.dshRemoteLoginTabs>button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.dshRemoteLoginTabs>button.isActive{color:var(--dsw-alias-label-primary);font-weight:600}.dshRemoteLoginTabs>button.isActive::after{content:"";position:absolute;right:12px;bottom:-1px;left:12px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary)}.dshRemoteLoginTabs>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:6px}',
          ".dshRemoteClientLogin{width:min(440px,100%);display:flex;flex-direction:column;gap:8px}.dshRemoteClientLogin input{min-height:40px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:inherit;padding:0 12px;font:inherit}.dshRemoteClientLogin button{align-self:flex-start;min-height:40px;border:0;border-radius:8px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);padding:8px 16px;cursor:pointer}",
          ".dshRemoteQrLogin{width:min(440px,100%);display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0 2px;text-align:center}.dshRemoteQrLogin img,.dshRemoteQrPlaceholder{box-sizing:border-box;width:200px;height:200px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:#fff;padding:8px}.dshRemoteQrOpen{display:flex;flex-direction:column;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;text-decoration:none}.dshRemoteQrOpen:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteQrOpen:hover img{border-color:var(--dsw-alias-label-dimmed)}.dshRemoteQrOpen:focus-visible{border-radius:12px;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.dshRemoteQrPlaceholder{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}.dshRemoteQrLogin>strong{font-size:14px}.dshRemoteQrLogin>p{max-width:48ch;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.dshRemoteQrLogin>.dshRemoteServiceAddress{margin-top:2px;color:var(--dsw-alias-label-tertiary)}.dshRemoteServiceAddress>a{color:var(--dsw-alias-label-secondary);text-decoration:none}.dshRemoteServiceAddress>a:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteQrLogin>button,.dshRemoteClientLogin>.dshRemoteLoginSwitch{min-height:32px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 8px;font:inherit;font-size:12px;cursor:pointer}.dshRemoteQrLogin>button:hover,.dshRemoteClientLogin>.dshRemoteLoginSwitch:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteClientLogin>.dshRemoteLoginSwitch{align-self:flex-start;background:transparent;color:var(--dsw-alias-label-secondary);padding-left:0}",
          ".dshRemoteLoginHeading{box-sizing:border-box;width:100%;display:flex;align-items:baseline;gap:10px;overflow:hidden;white-space:nowrap}.dshRemoteLoginTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteLoginHeading>span{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:400}.dshRemoteLoginTabs{box-sizing:border-box;width:100%}.dshRemoteLoginTabs>button{min-width:0;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}.dshRemoteLoginTabs>button.isActive::after{right:0;left:0;border-radius:0}.dshRemoteClientLogin,.dshRemoteQrLogin{box-sizing:border-box;width:100%;height:300px;min-height:300px}.dshRemoteClientLogin{align-items:stretch;padding-top:16px}.dshRemoteClientLogin>button{align-self:stretch;width:100%}.dshRemoteQrLogin{padding-top:12px}",
          '.dshRemoteHostControlToggle{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap;cursor:default}.dshRemoteHostControlToggle>input{appearance:none;box-sizing:border-box;position:relative;width:32px;height:18px;flex:0 0 auto;margin:0;border:1px solid var(--dsw-alias-label-secondary);border-radius:999px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);transition:background .16s ease-out,border-color .16s ease-out,box-shadow .16s ease-out}.dshRemoteHostControlToggle>input::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .16s ease-out,background .16s ease-out}.dshRemoteHostControlToggle>input:checked{border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary);box-shadow:none}.dshRemoteHostControlToggle>input:checked::after{transform:translateX(14px);background:var(--dsw-alias-bg-layer-1)}.dshRemoteHostControlToggle>input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshRemoteHostControlToggle>input:disabled{opacity:.5;cursor:default}@media(prefers-reduced-motion:reduce){.dshRemoteHostControlToggle>input,.dshRemoteHostControlToggle>input::after{transition:none}}',
          ".dshRemoteAccountFooter{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:14px;color:var(--dsw-alias-label-secondary);font-size:12px}.dshRemoteAccountExit{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px 0;font-size:12px;line-height:1.5;white-space:nowrap}.dshRemoteAccountExit:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteAccountExit:disabled{opacity:.5;cursor:default;text-decoration:none}",
          ".dshRemoteLocalLink{align-self:flex-start;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 0;cursor:pointer}.dshRemoteLocalLink:hover{color:var(--dsw-alias-label-primary)}",
          "@keyframes dshRemotePageIn{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.dshRemotePage{animation:none}}@media(max-width:620px){.dshRemoteBackdrop{padding:12px}.dshRemotePage{max-height:calc(100vh - 24px)}.dshRemotePageHeader{gap:8px;padding:12px 16px}.dshRemotePage.hasSelectedHost .dshRemotePageBack{max-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteSectionHeading{align-items:flex-start;flex-direction:column;gap:8px}.dshRemoteWorkspaceHeading{align-items:center;flex-direction:row}.dshRemoteSectionActions{width:100%;justify-content:space-between}.dshRemotePageBody{padding:20px 16px}.dshRemoteOpenBar{align-items:flex-end}.dshRemoteOpenBar>button{min-height:48px}}",
          ".dshRemoteBackdrop{position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-mask-3);display:grid;place-items:center;padding:20px}",
          ".dshRemoteDialog{width:min(460px,100%);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px;display:grid;gap:12px;box-shadow:var(--dsw-shadow-lv2)}",
          ".dshRemoteDialog button,.dshRemoteDialog input{font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 10px;background:transparent;color:inherit}",
          ".dshRemoteDialog button:not(:disabled){cursor:pointer}.dshRemoteDialog button:disabled{opacity:.5}",
          ".dshRemoteHeader{display:flex;align-items:center;justify-content:space-between}.dshRemoteHeader button{border:0;font-size:22px;padding:0 6px}",
          ".dshRemoteDevices{display:grid;gap:8px}.dshRemoteDevices p{margin:4px 0;color:var(--dsw-alias-label-secondary)}",
          ".dshRemoteError{margin:0;color:var(--dsw-alias-state-error-primary)}",
          ".dshRemoteHostAccount{display:grid;gap:8px;border-top:1px solid var(--dsw-alias-border-l3);padding-top:12px}.dshRemoteHostAccount p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}",
          ".dshRemoteLogin{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dshRemoteLogin button{grid-column:1/-1}",
          ".dshRemotePluginCard{list-style:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s}",
          ".dshRemotePluginModern{box-sizing:border-box;width:100%;max-width:768px;box-shadow:none}.dshRemotePluginModern>.dshRemotePluginCardHeader{display:none}.dshRemotePluginModern>.dshRemotePluginCardBody{border-top:0;margin:0;padding:8px 20px}",
          ".dshRemotePluginCard:hover{border-color:var(--dsw-alias-label-dimmed)}.dshRemotePluginCard.isOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
          ".dshRemotePluginCardHeader{display:flex;align-items:center}.dshRemotePluginCardToggle{appearance:none;width:100%;min-width:0;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}.dshRemotePluginCardToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
          ".dshRemotePluginCardHeading{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.dshRemotePluginCardHeading>strong{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dshRemotePluginCardHeading>span{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dshRemotePluginCardStatus{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.dshRemotePluginCardStatus.isOnline{color:var(--dsw-alias-state-success-primary)}.dshRemotePluginCardStatus.isReconnecting{color:var(--dsw-alias-state-warn-label)}.dshRemotePluginCardStatus.isOffline{color:var(--dsw-alias-state-error-primary)}.dshRemotePluginCardChevron{color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:14px;transition:transform .16s}.dshRemotePluginCard.isOpen .dshRemotePluginCardChevron{transform:rotate(180deg)}",
          ".dshRemotePluginCardBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.dshRemoteSettings{display:flex;flex-direction:column;max-width:720px}.dshRemoteSettingsTop{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}.dshRemoteSettingsState{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
          ".dshRemoteHostIdentity{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2)}.dshRemoteHostIdentity>div{min-width:0;display:flex;flex-direction:column;gap:3px}.dshRemoteHostIdentity span{color:var(--dsw-alias-label-tertiary);font-size:12px}.dshRemoteHostIdentity strong,.dshRemoteHostIdentity code{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}.dshRemoteHostIdentity code{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-weight:400}",
          ".dshRemoteField{display:flex;flex-direction:column;gap:6px;padding:12px 0}.dshRemoteField+.dshRemoteField{border-top:1px solid var(--dsw-alias-border-l2)}.dshRemoteField label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}.dshRemoteField input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.dshRemoteField input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.dshRemoteField input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.dshRemoteField p{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
          '.dshRemoteAuthorizationSetting{border-top:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0}.dshRemoteAuthorizationSetting>div{min-width:0}.dshRemoteAuthorizationSetting strong{font-size:13px;font-weight:500}.dshRemoteAuthorizationSetting p{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}.dshRemoteAuthorizationSetting>input{appearance:none;position:relative;width:38px;height:22px;flex:0 0 auto;margin:0;border:1px solid var(--dsw-alias-label-secondary);border-radius:999px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);transition:background .16s ease-out,border-color .16s ease-out,box-shadow .16s ease-out}.dshRemoteAuthorizationSetting>input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .16s ease-out,background .16s ease-out}.dshRemoteAuthorizationSetting>input:checked{border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary);box-shadow:none}.dshRemoteAuthorizationSetting>input:checked::after{transform:translateX(16px);background:var(--dsw-alias-bg-layer-1)}.dshRemoteAuthorizationSetting>input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshRemoteAuthorizationSetting>input:disabled{opacity:.5;cursor:default}@media(prefers-reduced-motion:reduce){.dshRemoteAuthorizationSetting>input,.dshRemoteAuthorizationSetting>input::after{transition:none}}',
          ".dshRemoteAssociation{min-width:0;flex:1;display:flex;flex-direction:column;gap:4px}.dshRemoteAssociation>span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dshRemoteAssociation strong{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:1.5}.dshRemoteAssociation p{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
          ".dshRemoteConnection{border-top:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}.dshRemoteConnectionSummary{min-width:0;display:flex;flex-direction:column;gap:4px}.dshRemoteConnectionSummary>span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dshRemoteConnectionSummary strong{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:1.5}.dshRemoteConnectionSummary p,.dshRemoteConnectionIssue{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.dshRemoteConnectionDot{width:8px;height:8px;flex:0 0 auto;border-radius:999px;background:var(--dsw-alias-label-tertiary)}.dshRemoteConnectionDot.isOnline{background:var(--dsw-alias-state-success-primary)}.dshRemoteConnectionDot.isReconnecting{background:var(--dsw-alias-state-warn-primary)}.dshRemoteConnectionDot.isOffline{background:var(--dsw-alias-state-error-primary)}.dshRemoteConnectionIssue{color:var(--dsw-alias-state-error-primary);padding:0 0 12px}.dshRemoteReconnect{appearance:none;flex:0 0 auto;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);min-height:34px;padding:5px 14px;font-size:13px;line-height:1.5}.dshRemoteReconnect:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteReconnect:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dshRemoteReconnect:disabled{opacity:.4;cursor:default}",
          ".dshRemoteSettingsFooter{border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px}.dshRemoteSettingsFooter .dshRemoteError,.dshRemoteNotice{min-width:0;flex:1;margin:0;font-size:12px;line-height:1.5}.dshRemoteNotice{color:var(--dsw-alias-label-tertiary)}.dshRemoteDiscard,.dshRemoteSave{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.dshRemoteDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent}.dshRemoteDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dshRemoteSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dshRemoteDiscard:disabled,.dshRemoteSave:disabled{opacity:.4;cursor:default}.dshRemoteDiscard:focus-visible,.dshRemoteSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
          "@media(max-width:620px){.dshRemotePluginCardStatus{display:none}.dshRemoteSettingsTop{gap:10px}.dshRemoteConnection{align-items:flex-start}.dshRemoteReconnect{min-height:40px}}"
        ].join(""), document.head.append(style), () => style.remove();
      }
      function apply(ctx) {
        if (window.__DS_HARNESS_REMOTE_CLIENT_ACTIVE__) return;
        window.__DS_HARNESS_REMOTE_CLIENT_ACTIVE__ = !0, ctx.effect(() => () => {
          window.__DS_HARNESS_REMOTE_CLIENT_ACTIVE__ = !1;
        }, "ds-harness-remote: client singleton");
        let t = ctx.locale.bind(localeNamespace), controlRouteRetryAfter = 0, controlRouteBackoffIndex = 0, control = async (endpoint, payload = {}) => {
          if (endpoint === "status" && Date.now() < controlRouteRetryAfter)
            return controlRouteUnavailableStatus();
          let result;
          try {
            result = await ctx.connection.rpc.call(CONTROL_RPC_PREFIX, endpoint, payload), controlRouteRetryAfter = 0, controlRouteBackoffIndex = 0;
          } catch (reason) {
            if (!isMissingControlRoute(reason)) throw reason;
            let delayMs = controlRouteBackoffStepsMs[Math.min(controlRouteBackoffIndex, controlRouteBackoffStepsMs.length - 1)];
            if (controlRouteBackoffIndex += 1, controlRouteRetryAfter = Date.now() + delayMs, endpoint === "status") return controlRouteUnavailableStatus();
            throw new ControlRouteUnavailableError(t("remoteControlUnavailable"));
          }
          if (!result.ok) throw new Error(result.error?.message ?? t("remoteRequestFailed"));
          return result.value;
        }, statusFeed = createStatusFeed({
          url: STATUS_STREAM_PATH.slice(1),
          readStatus: () => control("status"),
          onFallback: (reason) => {
            console.warn("ds-harness-remote: status event stream unavailable, polling status instead:", reason);
          }
        });
        ctx.effect(() => () => statusFeed.close(), "ds-harness-remote: status stream"), ctx.effect(() => {
          let disposed = !1, unsubscribeWorkspaces, unsubscribeSessions, selection, opening = !1, reconcile = () => {
            if (disposed || opening || selection === void 0) return;
            let pending = selection, workspaceSnapshot = ctx.workspaces.list.getSnapshot();
            if (!workspacesReady(workspaceSnapshot) || !workspaceSnapshot.items.some((workspace) => workspace.workspaceId === pending.workspaceId)) return;
            let sessionSnapshot = ctx.sessions.list.getSnapshot(), isVirtualBackend = pending.backend === "codex" || pending.backend === "cursor" || pending.backend === "antigravity";
            if (isVirtualBackend && pending.sessionId !== void 0 && sessionSnapshot.phase !== "ready") return;
            opening = !0, unsubscribeWorkspaces?.(), unsubscribeSessions?.(), unsubscribeWorkspaces = void 0, unsubscribeSessions = void 0;
            let navigation = ctx.get("uiWorkspace"), connectWorkspace = (workspaceId) => navigation !== void 0 ? navigation.connectWorkspace(workspaceId) : ctx.workspaces.connectWorkspace(workspaceId);
            (isVirtualBackend && pending.sessionId !== void 0 && sessionSnapshot.ids.includes(pending.sessionId) ? Promise.resolve(pending.sessionId) : connectWorkspace(pending.workspaceId)).then(async (sessionId) => {
              if (!disposed) {
                if (navigation !== void 0)
                  navigation.openSession(sessionId);
                else if (typeof ctx.workspaces.openSession == "function")
                  ctx.workspaces.openSession(sessionId);
                else if (typeof ctx.sessions.open == "function")
                  ctx.sessions.open(sessionId);
                else
                  throw new Error("No supported Session open API is available.");
                window.sessionStorage.removeItem(pendingWorkspaceSelectionKey), await control("workspace.selection.consume", pending).catch(() => {
                });
              }
            }).catch((reason) => {
              disposed || console.warn("remote workspace selection failed:", reason);
            });
          };
          return control("status").then((status) => {
            let pending = status.workspaceSelection ?? storedWorkspaceSelection();
            disposed || status.mode !== "remote" || pending === void 0 || status.target?.deviceId !== pending.targetDeviceId || (selection = pending, unsubscribeWorkspaces = ctx.workspaces.list.subscribe(reconcile), unsubscribeSessions = ctx.sessions.list.subscribe(reconcile), reconcile());
          }).catch(() => {
          }), () => {
            disposed = !0, unsubscribeWorkspaces?.(), unsubscribeSessions?.();
          };
        }, "ds-harness-remote: resume selected workspace"), ctx.inject(["fileViewer"], (fileViewerContext) => {
          let viewer = fileViewerContext.get("fileViewer");
          viewer !== void 0 && fileViewerContext.effect(() => {
            let unregister, latestSaveAsAllowed = !1, latestSaveAsMaxBytes = REMOTE_FILE_SAVE_AS_MAX_BYTES, unsubscribe = statusFeed.subscribe((status) => {
              let supported = shouldUseRemoteFileViewer(status);
              latestSaveAsAllowed = shouldAllowRemoteFileSaveAs(status), latestSaveAsMaxBytes = remoteFileSaveAsMaxBytes(status), supported && unregister === void 0 ? unregister = viewer.registerContentProvider(createRemoteFileContentProvider(
                (endpoint, payload) => control(endpoint, payload),
                { saveAsAllowed: () => latestSaveAsAllowed, saveAsMaxBytes: () => latestSaveAsMaxBytes }
              )) : !supported && unregister !== void 0 && (unregister(), unregister = void 0, latestSaveAsAllowed = !1, latestSaveAsMaxBytes = REMOTE_FILE_SAVE_AS_MAX_BYTES);
            });
            return () => {
              unsubscribe(), unregister?.();
            };
          }, "ds-harness-remote: remote file viewer provider");
        }), ctx.effect(() => ctx.locale.register(localeNamespace, { zh, en }), "ds-harness-remote: dictionaries"), ctx.effect(installStyle, "ds-harness-remote: client styles"), ctx.effect(() => installTerminalAvailabilityNotice(statusFeed, t), "ds-harness-remote: terminal availability notice"), ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay",
          id: "ds-harness-remote-global-context",
          order: 20,
          locale: localeNamespace,
          inject: () => ({ control, statusFeed })
        }, RemoteSessionHeaderAction)), ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
          name: "sidebar.footer.action",
          id: "ds-harness-remote-workspace",
          order: -20,
          locale: localeNamespace,
          inject: () => ({
            control,
            statusFeed,
            preferredQrProvider: ctx.locale.getLocale().active === "zh" ? "zhihu" : "github"
          })
        }, RemoteWorkspaceAction)), ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
          name: "plugins.row.config",
          key: "ds-harness-remote#ds-harness-remote",
          locale: localeNamespace,
          inject: () => ({ control, statusFeed })
        }, RemotePluginOptions)), ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
          name: "plugins.bundle.config",
          key: "ds-harness-remote",
          locale: localeNamespace,
          inject: () => ({ control, statusFeed })
        }, RemotePluginOptions));
      }
      function isMissingControlRoute(reason) {
        return reason instanceof Error && reason.message.startsWith(`transport failure for ${CONTROL_RPC_PREFIX}/`) && (reason.message.endsWith(": HTTP 404") || reason.message.endsWith(": HTTP 405"));
      }
      function installTerminalAvailabilityNotice(feed, t) {
        let latest, notice, update = () => {
          let terminal = document.querySelector("[data-sidebar-terminal]"), unavailable = latest?.mode === "remote" && latest.remoteFeatures?.terminal !== !0;
          if (!terminal || !unavailable) {
            notice?.remove(), notice = void 0;
            return;
          }
          notice !== void 0 && notice.isConnected || (notice = document.createElement("div"), notice.className = "dshRemoteTerminalUnavailable", notice.setAttribute("role", "alert"), notice.textContent = t("terminalRemoteUnavailable"), terminal.prepend(notice));
        }, unsubscribe = feed.subscribe((status) => {
          latest = status, update();
        }), observer = new MutationObserver(update);
        return observer.observe(document.body, { childList: !0, subtree: !0 }), update(), () => {
          unsubscribe(), observer.disconnect(), notice?.remove();
        };
      }
      function messageOf(reason) {
        return reason instanceof Error ? reason.message : String(reason);
      }
      function formatPlatform(value) {
        let normalized = value.toLowerCase();
        return normalized === "darwin" || normalized === "macos" ? "macOS" : normalized === "win32" || normalized === "windows" ? "Windows" : normalized === "linux" ? "Linux" : normalized === "android" ? "Android" : value;
      }
      function connectedClientModeLabel(mode, t) {
        return t(mode === "LAN" ? "remoteNetworkLan" : mode === "P2P" ? "remoteNetworkP2p" : mode === "TURN" ? "remoteNetworkTurn" : mode === "Relay" ? "remoteNetworkRelay" : "connected");
      }
      return module.exports.apply = apply, module.exports.inject = inject, module.exports;
    }
  });
})();
