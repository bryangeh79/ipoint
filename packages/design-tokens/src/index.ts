export const colors = {
  brand: {
    primary: '#20B366',
    primaryHover: '#188F51',
    primaryActive: '#137443',
    primarySoft: '#E9F8F0',
    secondary: '#C89B2C',
    secondaryHover: '#A77E1F',
    secondarySoft: '#FBF5E6',
  },
  neutral: {
    0: '#FFFFFF',
    25: '#FCFDFC',
    50: '#F6F8F7',
    100: '#EDF1EF',
    200: '#DCE3DF',
    300: '#C2CDC7',
    400: '#8D9B94',
    500: '#64736B',
    600: '#46534C',
    700: '#334039',
    800: '#202B25',
    900: '#121A16',
  },
  semantic: {
    success: '#168A4B',
    successSoft: '#E8F7EF',
    warning: '#A76600',
    warningSoft: '#FFF5DB',
    error: '#C53632',
    errorSoft: '#FDEDEC',
    info: '#246BCE',
    infoSoft: '#EAF2FD',
  },
} as const;

export const spacing = {
  0: '0',
  0.5: '4px',
  1: '8px',
  1.5: '12px',
  2: '16px',
  3: '24px',
  4: '32px',
  5: '40px',
  6: '48px',
  8: '64px',
  10: '80px',
  12: '96px',
} as const;

export const radii = {
  sm: '12px',
  md: '16px',
  lg: '20px',
  round: '999px',
} as const;

export const typography = {
  fontFamily: {
    latin: 'Inter, "Noto Sans", sans-serif',
    simplifiedChinese: '"Noto Sans SC", Inter, sans-serif',
    traditionalChinese: '"Noto Sans TC", Inter, sans-serif',
    sea: '"Noto Sans", Inter, sans-serif',
  },
  fontSize: {
    caption: '0.75rem',
    bodySmall: '0.875rem',
    body: '1rem',
    h3: '1.25rem',
    h2: '1.5rem',
    h1: 'clamp(1.75rem, 4vw, 2.25rem)',
  },
  lineHeight: {
    tight: 1.2,
    heading: 1.3,
    body: 1.5,
  },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const breakpoints = {
  sm: '480px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export const motion = {
  duration: { instant: '0ms', fast: '120ms', normal: '200ms', slow: '320ms' },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    entrance: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} as const;

export const zIndex = {
  base: 0,
  sticky: 100,
  navigation: 200,
  overlay: 500,
  modal: 600,
  toast: 700,
} as const;

export const shadows = {
  card: '0 1px 2px rgb(18 26 22 / 5%), 0 8px 24px rgb(18 26 22 / 6%)',
  overlay: '0 24px 64px rgb(18 26 22 / 18%)',
} as const;

export const designTokens = {
  colors,
  spacing,
  radii,
  typography,
  breakpoints,
  motion,
  zIndex,
  shadows,
} as const;

export type DesignTokens = typeof designTokens;
export const designSystemStatus = 'official-v1-foundation' as const;
