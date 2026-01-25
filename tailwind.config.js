/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                discord: {
                    'primary': '#313338',
                    'secondary': '#2b2d31',
                    'tertiary': '#1e1f22',
                    'blurple': '#5865f2',
                    'green': '#23a559',
                    'red': '#f23f43',
                }
            }
        },
    },
    plugins: [],
}
