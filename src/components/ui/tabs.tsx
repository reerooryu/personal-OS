"use client";
import * as T from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex rounded-lg border border-line bg-surface p-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink data-[state=active]:bg-white/[0.08] data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}
