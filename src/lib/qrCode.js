const ERROR_CORRECTION_LEVEL_L = 1;
const PAD_BYTES = [0xec, 0x11];
const RS_BLOCKS_L = Object.freeze({
  1: [[1, 26, 19]],
  2: [[1, 44, 34]],
  3: [[1, 70, 55]],
  4: [[1, 100, 80]],
  5: [[1, 134, 108]],
  6: [[2, 86, 68]],
  7: [[2, 98, 78]],
  8: [[2, 121, 97]],
  9: [[2, 146, 116]],
  10: [[2, 86, 68], [2, 87, 69]],
});
const ALIGNMENT_PATTERNS = Object.freeze({
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
});

const EXP_TABLE = new Array(256).fill(0);
const LOG_TABLE = new Array(256).fill(0);
for (let index = 0; index < 8; index += 1) EXP_TABLE[index] = 1 << index;
for (let index = 8; index < 256; index += 1) {
  EXP_TABLE[index] = EXP_TABLE[index - 4]
    ^ EXP_TABLE[index - 5]
    ^ EXP_TABLE[index - 6]
    ^ EXP_TABLE[index - 8];
}
for (let index = 0; index < 255; index += 1) LOG_TABLE[EXP_TABLE[index]] = index;

function gexp(value) {
  let normalized = value;
  while (normalized < 0) normalized += 255;
  while (normalized >= 256) normalized -= 255;
  return EXP_TABLE[normalized];
}

class BitBuffer {
  constructor() {
    this.bytes = [];
    this.length = 0;
  }

  put(value, length) {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.putBit(((value >>> index) & 1) === 1);
    }
  }

  putBit(bit) {
    const byteIndex = Math.floor(this.length / 8);
    if (this.bytes.length <= byteIndex) this.bytes.push(0);
    if (bit) this.bytes[byteIndex] |= 0x80 >>> (this.length % 8);
    this.length += 1;
  }
}

function getTextBytes(value) {
  return [...new TextEncoder().encode(String(value ?? ""))];
}

function getRsBlocks(version) {
  const groups = RS_BLOCKS_L[version];
  if (!groups) throw new Error("qr_payload_too_large");
  return groups.flatMap(([count, totalCount, dataCount]) => (
    Array.from({ length: count }, () => ({ totalCount, dataCount }))
  ));
}

function getErrorPolynomial(length) {
  let polynomial = [1];
  for (let index = 0; index < length; index += 1) {
    const next = new Array(polynomial.length + 1).fill(0);
    polynomial.forEach((coefficient, position) => {
      next[position] ^= coefficient;
      next[position + 1] ^= coefficient ? gexp(LOG_TABLE[coefficient] + index) : 0;
    });
    polynomial = next;
  }
  return polynomial;
}

function getErrorCorrectionBytes(data, length) {
  const generator = getErrorPolynomial(length);
  const work = [...data, ...new Array(length).fill(0)];
  for (let offset = 0; offset < data.length; offset += 1) {
    const coefficient = work[offset];
    if (!coefficient) continue;
    const ratio = LOG_TABLE[coefficient];
    generator.forEach((generatorValue, index) => {
      if (generatorValue) work[offset + index] ^= gexp(LOG_TABLE[generatorValue] + ratio);
    });
  }
  return work.slice(data.length);
}

function createCodewords(version, dataBytes) {
  const blocks = getRsBlocks(version);
  const totalDataCount = blocks.reduce((sum, block) => sum + block.dataCount, 0);
  const buffer = new BitBuffer();
  buffer.put(4, 4);
  buffer.put(dataBytes.length, version < 10 ? 8 : 16);
  dataBytes.forEach((byte) => buffer.put(byte, 8));
  if (buffer.length > totalDataCount * 8) throw new Error("qr_payload_too_large");

  if (buffer.length + 4 <= totalDataCount * 8) buffer.put(0, 4);
  while (buffer.length % 8 !== 0) buffer.putBit(false);
  let padIndex = 0;
  while (buffer.bytes.length < totalDataCount) {
    buffer.put(PAD_BYTES[padIndex % PAD_BYTES.length], 8);
    padIndex += 1;
  }

  const dataBlocks = [];
  const errorBlocks = [];
  let offset = 0;
  blocks.forEach((block) => {
    const blockData = buffer.bytes.slice(offset, offset + block.dataCount);
    offset += block.dataCount;
    dataBlocks.push(blockData);
    errorBlocks.push(getErrorCorrectionBytes(blockData, block.totalCount - block.dataCount));
  });

  const codewords = [];
  const maxDataLength = Math.max(...dataBlocks.map((block) => block.length));
  const maxErrorLength = Math.max(...errorBlocks.map((block) => block.length));
  for (let index = 0; index < maxDataLength; index += 1) {
    dataBlocks.forEach((block) => {
      if (index < block.length) codewords.push(block[index]);
    });
  }
  for (let index = 0; index < maxErrorLength; index += 1) {
    errorBlocks.forEach((block) => {
      if (index < block.length) codewords.push(block[index]);
    });
  }
  return codewords;
}

function getBchDigit(value) {
  let digit = 0;
  let current = value;
  while (current !== 0) {
    digit += 1;
    current >>>= 1;
  }
  return digit;
}

function getBchTypeInfo(data) {
  let value = data << 10;
  const generator = 0x537;
  while (getBchDigit(value) - getBchDigit(generator) >= 0) {
    value ^= generator << (getBchDigit(value) - getBchDigit(generator));
  }
  return ((data << 10) | value) ^ 0x5412;
}

function getBchTypeNumber(data) {
  let value = data << 12;
  const generator = 0x1f25;
  while (getBchDigit(value) - getBchDigit(generator) >= 0) {
    value ^= generator << (getBchDigit(value) - getBchDigit(generator));
  }
  return (data << 12) | value;
}

function getMask(maskPattern, row, column) {
  switch (maskPattern) {
    case 0: return (row + column) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return column % 3 === 0;
    case 3: return (row + column) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5: return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6: return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    case 7: return (((row * column) % 3) + ((row + column) % 2)) % 2 === 0;
    default: return false;
  }
}

function setupPositionProbe(modules, row, column) {
  const size = modules.length;
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    const targetRow = row + rowOffset;
    if (targetRow < 0 || targetRow >= size) continue;
    for (let columnOffset = -1; columnOffset <= 7; columnOffset += 1) {
      const targetColumn = column + columnOffset;
      if (targetColumn < 0 || targetColumn >= size) continue;
      modules[targetRow][targetColumn] = (
        rowOffset >= 0 && rowOffset <= 6
        && (
          columnOffset === 0
          || columnOffset === 6
          || (columnOffset >= 2 && columnOffset <= 4 && rowOffset >= 2 && rowOffset <= 4)
        )
      ) || (
        columnOffset >= 0 && columnOffset <= 6
        && (rowOffset === 0 || rowOffset === 6)
      );
    }
  }
}

function setupAlignmentPatterns(modules, version) {
  const positions = ALIGNMENT_PATTERNS[version] ?? [];
  positions.forEach((row) => {
    positions.forEach((column) => {
      if (modules[row][column] !== null) return;
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          modules[row + rowOffset][column + columnOffset] = (
            Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) !== 1
          );
        }
      }
    });
  });
}

function setupTimingPatterns(modules) {
  const size = modules.length;
  for (let index = 8; index < size - 8; index += 1) {
    if (modules[index][6] === null) modules[index][6] = index % 2 === 0;
    if (modules[6][index] === null) modules[6][index] = index % 2 === 0;
  }
}

function setupTypeNumber(modules, version, test) {
  if (version < 7) return;
  const bits = getBchTypeNumber(version);
  const size = modules.length;
  for (let index = 0; index < 18; index += 1) {
    const dark = !test && ((bits >>> index) & 1) === 1;
    modules[Math.floor(index / 3)][(index % 3) + size - 11] = dark;
    modules[(index % 3) + size - 11][Math.floor(index / 3)] = dark;
  }
}

function setupTypeInfo(modules, maskPattern, test) {
  const data = (ERROR_CORRECTION_LEVEL_L << 3) | maskPattern;
  const bits = getBchTypeInfo(data);
  const size = modules.length;
  for (let index = 0; index < 15; index += 1) {
    const dark = !test && ((bits >>> index) & 1) === 1;
    if (index < 6) modules[index][8] = dark;
    else if (index < 8) modules[index + 1][8] = dark;
    else modules[index + size - 15][8] = dark;

    if (index < 8) modules[8][size - index - 1] = dark;
    else if (index < 9) modules[8][15 - index] = dark;
    else modules[8][15 - index - 1] = dark;
  }
  modules[size - 8][8] = !test;
}

function mapCodewords(modules, codewords, maskPattern) {
  const size = modules.length;
  let row = size - 1;
  let direction = -1;
  let byteIndex = 0;
  let bitIndex = 7;
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const targetColumn = column - offset;
        if (modules[row][targetColumn] !== null) continue;
        let dark = false;
        if (byteIndex < codewords.length) {
          dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        }
        if (getMask(maskPattern, row, targetColumn)) dark = !dark;
        modules[row][targetColumn] = dark;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
}

function makeMatrix(version, codewords, maskPattern, test = false) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  setupPositionProbe(modules, 0, 0);
  setupPositionProbe(modules, size - 7, 0);
  setupPositionProbe(modules, 0, size - 7);
  setupAlignmentPatterns(modules, version);
  setupTimingPatterns(modules);
  setupTypeNumber(modules, version, test);
  setupTypeInfo(modules, maskPattern, test);
  mapCodewords(modules, codewords, maskPattern);
  return modules;
}

function getLostPoint(modules) {
  const size = modules.length;
  let lostPoint = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let sameCount = 0;
      const dark = modules[row][column];
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        const neighborRow = row + rowOffset;
        if (neighborRow < 0 || neighborRow >= size) continue;
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          const neighborColumn = column + columnOffset;
          if (
            neighborColumn < 0
            || neighborColumn >= size
            || (rowOffset === 0 && columnOffset === 0)
          ) continue;
          if (dark === modules[neighborRow][neighborColumn]) sameCount += 1;
        }
      }
      if (sameCount > 5) lostPoint += 3 + sameCount - 5;
    }
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const count = [
        modules[row][column],
        modules[row + 1][column],
        modules[row][column + 1],
        modules[row + 1][column + 1],
      ].filter(Boolean).length;
      if (count === 0 || count === 4) lostPoint += 3;
    }
  }

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size - 6; column += 1) {
      if (
        modules[row][column]
        && !modules[row][column + 1]
        && modules[row][column + 2]
        && modules[row][column + 3]
        && modules[row][column + 4]
        && !modules[row][column + 5]
        && modules[row][column + 6]
      ) lostPoint += 40;
    }
  }
  for (let column = 0; column < size; column += 1) {
    for (let row = 0; row < size - 6; row += 1) {
      if (
        modules[row][column]
        && !modules[row + 1][column]
        && modules[row + 2][column]
        && modules[row + 3][column]
        && modules[row + 4][column]
        && !modules[row + 5][column]
        && modules[row + 6][column]
      ) lostPoint += 40;
    }
  }

  const darkCount = modules.flat().filter(Boolean).length;
  lostPoint += (Math.abs((100 * darkCount) / (size * size) - 50) / 5) * 10;
  return lostPoint;
}

function selectVersion(dataBytes) {
  for (let version = 1; version <= 10; version += 1) {
    const totalDataCount = getRsBlocks(version).reduce((sum, block) => sum + block.dataCount, 0);
    const lengthBits = version < 10 ? 8 : 16;
    if (4 + lengthBits + dataBytes.length * 8 <= totalDataCount * 8) return version;
  }
  throw new Error("qr_payload_too_large");
}

export function createQrMatrix(value) {
  const dataBytes = getTextBytes(value);
  const version = selectVersion(dataBytes);
  const codewords = createCodewords(version, dataBytes);
  let bestMatrix = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let maskPattern = 0; maskPattern < 8; maskPattern += 1) {
    const testMatrix = makeMatrix(version, codewords, maskPattern, true);
    const score = getLostPoint(testMatrix);
    if (score < bestScore) {
      bestScore = score;
      bestMatrix = makeMatrix(version, codewords, maskPattern, false);
    }
  }
  return bestMatrix;
}

export function createQrPath(value, quietZone = 4) {
  const matrix = createQrMatrix(value);
  const offset = Math.max(0, Math.round(Number(quietZone) || 0));
  const path = [];
  matrix.forEach((row, rowIndex) => {
    row.forEach((dark, columnIndex) => {
      if (dark) path.push(`M${columnIndex + offset} ${rowIndex + offset}h1v1h-1z`);
    });
  });
  return {
    path: path.join(""),
    size: matrix.length + offset * 2,
  };
}
