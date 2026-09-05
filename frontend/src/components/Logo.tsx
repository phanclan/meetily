import React from "react";
import { isMeetnola } from "@/flavor";
const productName = isMeetnola ? "Meetnola" : "Meetily";
import Image from "next/image";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface LogoProps {
    isCollapsed: boolean;
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      {isCollapsed ? (
        <DialogTrigger asChild>
          <button ref={ref} aria-label={`About ${productName}`} className="flex items-center justify-start mb-2 cursor-pointer bg-transparent border-none p-0 hover:opacity-80 transition-opacity">
            {isMeetnola ? <span className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-sm font-semibold text-white">m</span> : <Image src="/logo-collapsed.png" alt="Logo" width={40} height={32} />}
          </button>
        </DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <button ref={ref} aria-label={`About ${productName}`} className="text-base font-semibold text-stone-900 cursor-pointer hover:opacity-80 transition-opacity">
            <span>{productName}</span>
          </button>
        </DialogTrigger>
      )}
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About {productName}</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Logo.displayName = "Logo";

export default Logo;
