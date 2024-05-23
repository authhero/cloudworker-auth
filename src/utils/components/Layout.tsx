import type { FC } from "hono/jsx";
import { VendorSettings } from "../../types";
import AppLogo from "./AppLogo";
import i18next from "i18next";
import Footer from "./Footer";
import Icon from "./Icon";
import { html } from "hono/html";

type LayoutProps = {
  title: string;
  vendorSettings: VendorSettings;
  children: JSX.Element[] | JSX.Element;
};

const globalDocStyle = (vendorSettings: VendorSettings) => {
  const { style } = vendorSettings;
  // cannot render CSS directly in JSX but we can return a template string
  return `
    body {
      --primary-color: ${style.primaryColor};
      --primary-hover: ${style.primaryHoverColor};
      --text-on-primary: ${style.buttonTextColor};
    }
  `;
};

const DEFAULT_BG = "https://assets.sesamy.com/images/login-bg.jpg";

const Layout: FC<LayoutProps> = ({ title, children, vendorSettings }) => {
  const inlineStyles = {
    backgroundImage: `url(${
      vendorSettings?.loginBackgroundImage || DEFAULT_BG
    })`,
  };

  return (
    <html lang="en">
      <head>
        <title>{title}</title>
        <meta charset="UTF-8" />
        <meta name="robots" content="noindex, follow" />
        <link
          rel="preload"
          href="https://assets.sesamy.com/fonts/khteka/WOFF2/KHTeka-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="https://assets.sesamy.com/fonts/khteka/WOFF2/KHTeka-Medium.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="https://assets.sesamy.com/fonts/khteka/WOFF2/KHTeka-Bold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href="/css/tailwind.css" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
        />
        <style>{globalDocStyle(vendorSettings)}</style>
        {/* <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/favicons/apple-touch-icon.png"
        />
        <link
          rel="mask-icon"
          href="/favicons/safari-pinned-tab.svg"
          color="#000000"
        /> */}
        {/* <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicons/favicon-32x32-light.png"
        /> */}
        {/* <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicons/favicon-16x16-light.png"
        /> */}
        <meta name="theme-color" content="#000000" />
      </head>

      <body>
        <div
          class="row min-h-full w-full overflow-hidden bg-cover bg-center text-sm sm:bg-fixed sm:bg-left-top sm:pt-16 py-2"
          style={inlineStyles}
        >
          <div class="row-up-left w-[calc(100%-theme(space.2)-theme(space.2))] max-w-[1295px] !flex-nowrap sm:w-[calc(100%-theme(space.16)-theme(space.16))]">
            <div class="column-left w-full sm:w-auto">
              <div class="relative flex w-full flex-col rounded-2xl bg-white px-5 py-10 dark:bg-gray-800 dark:text-white sm:min-h-[700px] sm:max-w-md sm:px-14 sm:py-14 md:min-w-[448px] short:min-h-[558px] min-h-[calc(100vh-83px)]">
                <div class="mb-16">
                  <AppLogo vendorSettings={vendorSettings} />
                </div>
                <div class="flex flex-1 flex-col">
                  {children}
                  <Footer vendorSettings={vendorSettings} />
                </div>
              </div>

              <div class="flex w-full items-center px-6 pb-8 pt-4 justify-between">
                <div class="flex justify-center leading-[0]">
                  <a href="https://sesamy.com" target="_blank">
                    <Icon name="sesamy" className="text-xl text-white" />
                  </a>
                </div>
                <div class="flex justify-center space-x-2 text-xs text-white sm:justify-normal md:text-xs">
                  {vendorSettings.supportUrl && (
                    <a
                      class="text-xs text-white hover:underline md:text-xs"
                      href={vendorSettings.supportUrl}
                    >
                      {i18next.t("contact_support")}
                    </a>
                  )}
                  <span class="text-gray-300">|</span>{" "}
                  <span>{i18next.t("copyright_sesamy")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </body>
      {html`
        <script>
          // No need to use dangerouslySetInnerHTML.
          // If you write it here, it will not be escaped.
          console.log("Init");

          const initialBtn = document.getElementById("initial-btn");

          if (initialBtn) {
            document.getElementById("initial-btn").onclick = function () {
              console.log("Clicked");

              console.log(document.getElementById("code-input").value);

              const code = document.getElementById("code-input").value;

              if (code.length >= 6) {
                console.log("Valid code");

                document.getElementById("initial-btn").classList.add("hidden");
                document
                  .getElementById("loading-btn")
                  .classList.remove("hidden");
              }
            };
          }
        </script>
      `}
    </html>
  );
};

export default Layout;
