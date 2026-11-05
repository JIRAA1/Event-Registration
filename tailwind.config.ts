import type { Config } from 'tailwindcss';
const config: Config = { content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'], theme: { extend: { colors: { aru: { red: '#7C0A02', gold: '#D4AF37', canvas: '#EEF1F6' } }, borderRadius: { 'bento': '28px' } } }, plugins: [] };
export default config;
