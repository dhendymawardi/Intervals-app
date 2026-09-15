import "./globals.css";

export const metadata = {
  title: "Intervals — Learn Scales Through Interval Relationships",
  description:
    "A mobile-first app for improvisers. Learn scales, modes, and parent-scale relationships through intervals — not fretboard shapes. See the relationships and hear them with Audio Preview.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E0D0C",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
