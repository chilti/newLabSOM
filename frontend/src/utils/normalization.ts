export type NormalizationType = 
  | 'div_max' 
  | 'min_max'
  | 'z_score' 
  | 'cooc_cosine' 
  | 'cooc_association' 
  | 'cooc_jaccard' 
  | 'cooc_inclusion'
  | 'bipartite_row'
  | 'bipartite_col'
  | 'bipartite_sym';

export interface NormalizationInfo {
  type: NormalizationType;
  params: any;
}

export interface NormalizationResult {
  normalizedMatrix: number[][];
  scalerInfo: NormalizationInfo;
}

const cloneMatrix = (matrix: number[][]): number[][] => {
  return matrix.map(row => [...row]);
};

export const divideByMax = (matrix: number[][]): NormalizationResult => {
  if (!matrix || matrix.length === 0) return { normalizedMatrix: [], scalerInfo: { type: 'div_max', params: {} } };

  const cols = matrix[0].length;
  const maxValues = new Array(cols).fill(Number.NEGATIVE_INFINITY);

  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (matrix[r][c] > maxValues[c]) {
        maxValues[c] = matrix[r][c];
      }
    }
  }

  // Prevent division by zero
  const safeMaxValues = maxValues.map(v => v === 0 ? 1 : v);
  const normalizedMatrix = cloneMatrix(matrix);

  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < cols; c++) {
      normalizedMatrix[r][c] = matrix[r][c] / safeMaxValues[c];
    }
  }

  return {
    normalizedMatrix,
    scalerInfo: {
      type: 'div_max',
      params: { maxValues: safeMaxValues }
    }
  };
};

export const minMaxScale = (matrix: number[][]): NormalizationResult => {
  if (!matrix || matrix.length === 0) return { normalizedMatrix: [], scalerInfo: { type: 'min_max', params: {} } };

  const cols = matrix[0].length;
  const maxValues = new Array(cols).fill(Number.NEGATIVE_INFINITY);
  const minValues = new Array(cols).fill(Number.POSITIVE_INFINITY);

  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (matrix[r][c] > maxValues[c]) maxValues[c] = matrix[r][c];
      if (matrix[r][c] < minValues[c]) minValues[c] = matrix[r][c];
    }
  }

  const ranges = new Array(cols);
  for (let c = 0; c < cols; c++) {
    const range = maxValues[c] - minValues[c];
    ranges[c] = range === 0 ? 1 : range; // Prevent division by zero
  }

  const normalizedMatrix = cloneMatrix(matrix);
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < cols; c++) {
      normalizedMatrix[r][c] = (matrix[r][c] - minValues[c]) / ranges[c];
    }
  }

  return {
    normalizedMatrix,
    scalerInfo: {
      type: 'min_max',
      params: { minValues, maxValues, ranges }
    }
  };
};

export const zScoreStandardize = (matrix: number[][]): NormalizationResult => {
  if (!matrix || matrix.length === 0) return { normalizedMatrix: [], scalerInfo: { type: 'z_score', params: {} } };

  const rows = matrix.length;
  const cols = matrix[0].length;
  
  const means = new Array(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      means[c] += matrix[r][c];
    }
  }
  for (let c = 0; c < cols; c++) {
    means[c] /= rows;
  }

  const stdDevs = new Array(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      stdDevs[c] += Math.pow(matrix[r][c] - means[c], 2);
    }
  }
  // Population standard deviation (as per standard approach, unless bessel is required)
  for (let c = 0; c < cols; c++) {
    stdDevs[c] = Math.sqrt(stdDevs[c] / rows);
  }

  const safeStdDevs = stdDevs.map(v => v === 0 ? 1 : v);
  const normalizedMatrix = cloneMatrix(matrix);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      normalizedMatrix[r][c] = (matrix[r][c] - means[c]) / safeStdDevs[c];
    }
  }

  return {
    normalizedMatrix,
    scalerInfo: {
      type: 'z_score',
      params: { means, stdDevs: safeStdDevs }
    }
  };
};

export const cosineCooccurrence = (matrix: number[][]): NormalizationResult => {
  const normalizedMatrix = cloneMatrix(matrix);
  const rows = matrix.length;
  
  for (let i = 0; i < rows; i++) {
    for (let j = i; j < rows; j++) {
      if (i === j) {
        normalizedMatrix[i][j] = 1;
      } else {
        const temp = matrix[i][j] / Math.sqrt(matrix[i][i] * matrix[j][j]);
        const safeTemp = isNaN(temp) ? 0 : temp;
        normalizedMatrix[i][j] = safeTemp;
        normalizedMatrix[j][i] = safeTemp;
      }
    }
  }
  return { normalizedMatrix, scalerInfo: { type: 'cooc_cosine', params: {} } };
};

export const associationStrengthCooccurrence = (matrix: number[][]): NormalizationResult => {
  const normalizedMatrix = cloneMatrix(matrix);
  const rows = matrix.length;

  for (let i = 0; i < rows; i++) {
    for (let j = i; j < rows; j++) {
      if (i === j) {
        normalizedMatrix[i][j] = 1;
      } else {
        const temp = matrix[i][j] / (matrix[i][i] * matrix[j][j]);
        const safeTemp = isNaN(temp) ? 0 : temp;
        normalizedMatrix[i][j] = safeTemp;
        normalizedMatrix[j][i] = safeTemp;
      }
    }
  }
  return { normalizedMatrix, scalerInfo: { type: 'cooc_association', params: {} } };
};

export const jaccardCooccurrence = (matrix: number[][]): NormalizationResult => {
  const normalizedMatrix = cloneMatrix(matrix);
  const rows = matrix.length;

  for (let i = 0; i < rows; i++) {
    for (let j = i; j < rows; j++) {
      if (i === j) {
        normalizedMatrix[i][j] = 1;
      } else {
        const temp = matrix[i][j] / (matrix[i][i] + matrix[j][j] - matrix[i][j]);
        const safeTemp = isNaN(temp) ? 0 : temp;
        normalizedMatrix[i][j] = safeTemp;
        normalizedMatrix[j][i] = safeTemp;
      }
    }
  }
  return { normalizedMatrix, scalerInfo: { type: 'cooc_jaccard', params: {} } };
};

export const inclusionCooccurrence = (matrix: number[][]): NormalizationResult => {
  const normalizedMatrix = cloneMatrix(matrix);
  const rows = matrix.length;

  for (let i = 0; i < rows; i++) {
    for (let j = i; j < rows; j++) {
      if (i === j) {
        normalizedMatrix[i][j] = 1;
      } else {
        const temp = matrix[i][j] / Math.min(matrix[i][i], matrix[j][j]);
        const safeTemp = isNaN(temp) ? 0 : temp;
        normalizedMatrix[i][j] = safeTemp;
        normalizedMatrix[j][i] = safeTemp;
      }
    }
  }
  return { normalizedMatrix, scalerInfo: { type: 'cooc_inclusion', params: {} } };
};

// Bipartite Normalizations
export const bipartiteRowNormalization = (matrix: number[][]): NormalizationResult => {
  if (!matrix || matrix.length === 0) return { normalizedMatrix: [], scalerInfo: { type: 'bipartite_row', params: {} } };
  
  const normalizedMatrix = cloneMatrix(matrix);
  const rows = matrix.length;
  const cols = matrix[0].length;
  const rowDegrees = new Array(rows).fill(0);

  // Calculate degrees (sum) for each row
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rowDegrees[r] += matrix[r][c];
    }
  }

  // Normalize
  for (let r = 0; r < rows; r++) {
    const degree = rowDegrees[r] === 0 ? 1 : rowDegrees[r]; // Avoid division by zero
    for (let c = 0; c < cols; c++) {
      normalizedMatrix[r][c] = matrix[r][c] / degree;
    }
  }

  return { normalizedMatrix, scalerInfo: { type: 'bipartite_row', params: { rowDegrees } } };
};

export const bipartiteColNormalization = (matrix: number[][]): NormalizationResult => {
  if (!matrix || matrix.length === 0) return { normalizedMatrix: [], scalerInfo: { type: 'bipartite_col', params: {} } };
  
  const normalizedMatrix = cloneMatrix(matrix);
  const rows = matrix.length;
  const cols = matrix[0].length;
  const colDegrees = new Array(cols).fill(0);

  // Calculate degrees (sum) for each column
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      colDegrees[c] += matrix[r][c];
    }
  }

  // Normalize
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const degree = colDegrees[c] === 0 ? 1 : colDegrees[c]; // Avoid division by zero
      normalizedMatrix[r][c] = matrix[r][c] / degree;
    }
  }

  return { normalizedMatrix, scalerInfo: { type: 'bipartite_col', params: { colDegrees } } };
};

export const bipartiteSymNormalization = (matrix: number[][]): NormalizationResult => {
  if (!matrix || matrix.length === 0) return { normalizedMatrix: [], scalerInfo: { type: 'bipartite_sym', params: {} } };
  
  const normalizedMatrix = cloneMatrix(matrix);
  const rows = matrix.length;
  const cols = matrix[0].length;
  const rowDegrees = new Array(rows).fill(0);
  const colDegrees = new Array(cols).fill(0);

  // Calculate degrees for rows and columns
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rowDegrees[r] += matrix[r][c];
      colDegrees[c] += matrix[r][c];
    }
  }

  // Normalize
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rDeg = rowDegrees[r] === 0 ? 1 : rowDegrees[r];
      const cDeg = colDegrees[c] === 0 ? 1 : colDegrees[c];
      normalizedMatrix[r][c] = matrix[r][c] / Math.sqrt(rDeg * cDeg);
    }
  }

  return { normalizedMatrix, scalerInfo: { type: 'bipartite_sym', params: { rowDegrees, colDegrees } } };
};

export const applyNormalizationToMatrix = (matrix: number[][], type: NormalizationType): NormalizationResult => {
  switch (type) {
    case 'div_max': return divideByMax(matrix);
    case 'min_max': return minMaxScale(matrix);
    case 'z_score': return zScoreStandardize(matrix);
    case 'cooc_cosine': return cosineCooccurrence(matrix);
    case 'cooc_association': return associationStrengthCooccurrence(matrix);
    case 'cooc_jaccard': return jaccardCooccurrence(matrix);
    case 'cooc_inclusion': return inclusionCooccurrence(matrix);
    case 'bipartite_row': return bipartiteRowNormalization(matrix);
    case 'bipartite_col': return bipartiteColNormalization(matrix);
    case 'bipartite_sym': return bipartiteSymNormalization(matrix);
    default: return { normalizedMatrix: cloneMatrix(matrix), scalerInfo: { type: 'div_max', params: {} } };
  }
};
