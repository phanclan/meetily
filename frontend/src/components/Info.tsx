import React from "react";
const productName = "Afterword";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface InfoProps {
    isCollapsed: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(({ isCollapsed }, ref) => {
  return (
    <div className="w-full">
      <Dialog aria-describedby={undefined}>
        <DialogTrigger asChild>
          <button
            ref={ref}
            type="button"
            className="rail-item w-full border-none text-gray-700 hover:bg-gray-100"
            title={`About ${productName}`}
            aria-label={`About ${productName}`}
          >
            <span className="rail-item-icon">
              <InfoIcon className="h-4 w-4 text-gray-700" />
            </span>
            {!isCollapsed && <span className="rail-item-label">About</span>}
          </button>
        </DialogTrigger>
        <DialogContent>
          <VisuallyHidden>
            <DialogTitle>About {productName}</DialogTitle>
          </VisuallyHidden>
          <About />
        </DialogContent>
      </Dialog>
    </div>
  );
});

Info.displayName = "About";

export default Info;
