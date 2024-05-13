import cn from "classnames";
import { UniversalLoginSession } from "../../adapters/interfaces/UniversalLoginSession";

type Props = {
  social: string;
  icon: JSX.Element | null;
  text: string;
  canResize?: boolean;
  session: UniversalLoginSession;
};

const SocialButton = ({
  social,
  text,
  icon = null,
  canResize = false,
  session,
}: Props) => {
  const connection = social === "google" ? "google-oauth2" : social;

  const queryString = new URLSearchParams({
    client_id: session.authParams.client_id,
    connection,
  });
  if (session.authParams.response_type) {
    queryString.set("response_type", session.authParams.response_type);
  }
  if (session.authParams.redirect_uri) {
    queryString.set("redirect_uri", session.authParams.redirect_uri);
  }
  if (session.authParams.scope) {
    queryString.set("scope", session.authParams.scope);
  }
  if (session.authParams.nonce) {
    queryString.set("nonce", session.authParams.nonce);
  }
  if (session.authParams.response_type) {
    queryString.set("response_type", session.authParams.response_type);
  }
  if (session.authParams.state) {
    queryString.set("state", session.authParams.state);
  }
  const href = `/authorize?${queryString.toString()}`;

  return (
    <a
      // should be class... does this still work either way now? but did it not??? hmmmm
      className={cn(
        "block",
        // copied from Button.tsx
        "relative w-full rounded-lg text-center px-4 py-5 bg-primary text-textOnPrimary hover:bg-primaryHover",
        "border border-gray-200 bg-white hover:bg-gray-100 dark:border-gray-400 dark:bg-black dark:hover:bg-black/90",
        {
          // what is this? is this why looks broken?
          ["px-0 py-3 sm:px-10 sm:py-4 short:px-0 short:py-3"]: canResize,
          ["px-10 py-3"]: !canResize,
        },
      )}
      //   variant="custom"
      aria-label={text}
      href={href}
    >
      {icon || ""}
      <div
        // should be class... does this still work either way now? but did it not??? hmmmm
        className={cn("text-left text-black dark:text-white sm:text-base", {
          ["hidden sm:inline short:hidden"]: canResize,
        })}
      >
        {text}
      </div>
    </a>
  );
};

export default SocialButton;
