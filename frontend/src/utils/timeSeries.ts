/**
 * Parses a label to extract the temporal entity and its time index.
 * Supports "Year_Entity" (e.g., "2025_BUAP") and "Entity_Year" (e.g., "BUAP_2025").
 */
export function parseTrajectoryEntity(label: string): { entity: string; timeText: string; isTemporal: boolean } {
  if (!label) return { entity: label, timeText: '', isTemporal: false };
  
  const parts = label.split('_');
  if (parts.length < 2) return { entity: label, timeText: '', isTemporal: false };

  // Heuristic: check if the first part or last part is a number (year/index)
  const firstPart = parts[0];
  const lastPart = parts[parts.length - 1];

  const isFirstNumber = !isNaN(Number(firstPart));
  const isLastNumber = !isNaN(Number(lastPart));

  if (isFirstNumber && !isLastNumber) {
    // Format: "2025_BUAP"
    return {
      entity: parts.slice(1).join('_'),
      timeText: firstPart,
      isTemporal: true
    };
  } else if (isLastNumber && !isFirstNumber) {
    // Format: "BUAP_2025"
    return {
      entity: parts.slice(0, parts.length - 1).join('_'),
      timeText: lastPart,
      isTemporal: true
    };
  } else if (isFirstNumber && isLastNumber) {
    // If both are numbers, default to first part as time
    return {
      entity: parts.slice(1).join('_'),
      timeText: firstPart,
      isTemporal: true
    };
  } else {
    // Default to classic PathSOM "Prefix_Entity" if neither is strictly a number
    // but there is an underscore.
    return {
      entity: parts.slice(1).join('_'),
      timeText: firstPart,
      isTemporal: true
    };
  }
}

/**
 * Applies Centered Moving Average (CMA) smoothing to a data matrix, grouped by entities.
 * @param matrix The original data matrix
 * @param labels The labels corresponding to each row
 * @param windowSize The smoothing window size (should be odd, e.g., 3, 5, 7)
 */
export function applyCmaSmoothing(matrix: number[][], labels: string[], windowSize: number): number[][] {
  if (!matrix || matrix.length === 0 || windowSize < 2) return matrix;

  const smoothedMatrix = matrix.map(row => [...row]); // Deep copy

  // 1. Group indices by entity
  const entityGroups = new Map<string, number[]>();
  labels.forEach((label, i) => {
    const { entity } = parseTrajectoryEntity(label);
    if (!entityGroups.has(entity)) {
      entityGroups.set(entity, []);
    }
    entityGroups.get(entity)!.push(i);
  });

  // 2. Apply smoothing per entity
  const halfWindow = Math.floor(windowSize / 2);

  entityGroups.forEach(indices => {
    // If an entity has too few points, we might still smooth but window effectively shrinks
    const n = indices.length;
    if (n < 2) return; // Cannot smooth single points

    const numFeatures = matrix[0].length;

    for (let i = 0; i < n; i++) {
      // Determine dynamic window for boundaries
      // To keep it centered, we take the minimum available distance to the edges,
      // or the requested halfWindow, whichever is smaller.
      const currentHalf = Math.min(halfWindow, i, n - 1 - i);
      
      const startIdx = i - currentHalf;
      const endIdx = i + currentHalf;
      const count = endIdx - startIdx + 1;

      for (let f = 0; f < numFeatures; f++) {
        let sum = 0;
        for (let k = startIdx; k <= endIdx; k++) {
          sum += matrix[indices[k]][f];
        }
        smoothedMatrix[indices[i]][f] = sum / count;
      }
    }
  });

  return smoothedMatrix;
}
