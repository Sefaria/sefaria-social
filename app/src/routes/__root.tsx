/// <reference types="vite/client" />
import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { SocialLayout } from "~/features/shell/SocialLayout";
import { SocialNotFound } from "~/features/shell/SocialNotFound";

// The Start app's root (standalone mode, R5): it renders the document shell (<html>). The surface has its own root, which
// renders content only (app/src/surface/route-tree.tsx); both trees share the page components and the frame
// (docs/decisions/0003-two-builds.md).
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sefaria Social" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: SocialNotFound,
});

function RootComponent() {
  return (
    <RootDocument>
      <SocialLayout>
        <Outlet />
      </SocialLayout>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
