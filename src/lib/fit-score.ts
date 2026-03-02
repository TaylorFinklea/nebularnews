export type FitScoreStatus = 'ready' | 'insufficient_signal' | null | undefined;

const toFitScoreNumber = (score: unknown) => {
  const numeric = Number(score);
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 5 ? Math.round(numeric) : null;
};

export const getFitScoreValue = (score: unknown, status?: FitScoreStatus) => {
  if (status === 'insufficient_signal') return null;
  return toFitScoreNumber(score);
};

export const getFitScoreTone = (score: unknown, status?: FitScoreStatus) => {
  if (status === 'insufficient_signal') return 'fit-learning';
  const value = getFitScoreValue(score, status);
  if (value === null) return 'fit-none';
  return `fit-${value}`;
};

export const getFitScoreText = (score: unknown, status?: FitScoreStatus) => {
  if (status === 'insufficient_signal') return 'Learning';
  const value = getFitScoreValue(score, status);
  return value === null ? '--' : `${value}/5`;
};

export const getFitScoreAria = (score: unknown, status?: FitScoreStatus) => {
  if (status === 'insufficient_signal') {
    return 'Learning your preferences';
  }
  const value = getFitScoreValue(score, status);
  return value === null ? 'AI fit score not available yet' : `AI fit score ${value} out of 5`;
};

export const getScoreToken = (score: unknown, status?: FitScoreStatus) => {
  if (status === 'insufficient_signal') return 'unscored';
  const value = getFitScoreValue(score, status);
  return value === null ? 'unscored' : String(value);
};
