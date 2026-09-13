'use client';

import React from 'react';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  return (
    <main className="relative z-[30] flex h-screen min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </main>
  );
};

export default MainContent;
