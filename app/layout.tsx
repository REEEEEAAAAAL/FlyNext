import "./globals.css";
import NavigationBar from "./components/NavigationBar";

export const metadata = {
  title: "FlyNext",
  description: "Your travel companion",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <NavigationBar />
        {children}
      </body>
    </html>
  );
}
