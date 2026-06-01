/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'purple-darkest': '#3b1259',
        'purple-dark': '#5c2680',
        'purple-mid': '#824dba',
        'purple-slate': '#7a6bc7',
        lavender: '#998fde',
        olive: '#87a93e',
        'bg-light': '#f5f0fa',
        'bg-page': '#faf8fd',
        'text-body': '#3d3d3d',
        'text-muted': '#7a7a8a',
        border: '#e0d5f0',
      },
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
