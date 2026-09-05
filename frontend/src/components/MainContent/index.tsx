'use client';

import React from 'react';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  return (
    <main className="min-w-0 flex-1">
      {children}
    </main>
  );
};

export default MainContent;
