"use client"

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { FilterSidebar } from "@/components/filter-sidebar"
import { InfoSidebar } from "@/components/info-sidebar"
import { FilterProvider } from "@/contexts/FilterContext"
import Globe from "@/components/Globe";
import { useState } from "react";

export default function Home() {
  const [isInfoSidebarOpen, setIsInfoSidebarOpen] = useState(true);

  return (
    <FilterProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          {/* Left Filter Sidebar - Pushes Content */}
          <FilterSidebar />
          
          {/* Resizable Main Content Area and Info Sidebar */}
          <ResizablePanelGroup direction="horizontal" className="flex-1">
            {/* Main Content Area */}
            <ResizablePanel 
              defaultSize={isInfoSidebarOpen ? 75 : 100} 
              minSize={50} 
              className="flex flex-col"
            >
              <SidebarInset className="flex flex-col h-screen">
                {/* Top Bar with Sidebar Triggers */}
                <div className="h-12 border-b flex items-center justify-between px-4 flex-shrink-0">
                  <div className="flex items-center">
                    <SidebarTrigger />
                    <h1 className="ml-4 text-lg font-semibold">PedX Visualizer</h1>
                  </div>
                  <button
                    onClick={() => setIsInfoSidebarOpen(!isInfoSidebarOpen)}
                    className="flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Info</span>
                    <svg
                      className={`w-4 h-4 transition-transform ${isInfoSidebarOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                
                {/* Cesium Globe - Fixed height based on viewport */}
                <div className="relative overflow-hidden flex-1">
                  <Globe />
                </div>
              </SidebarInset>
            </ResizablePanel>

            {/* Resizable Handle - Only show when sidebar is open */}
            {isInfoSidebarOpen && <ResizableHandle withHandle />}

            {/* Right Info Sidebar - Collapsible and Resizable */}
            {isInfoSidebarOpen && (
              <ResizablePanel defaultSize={25} minSize={20} maxSize={50}>
                <InfoSidebar />
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </div>
      </SidebarProvider>
    </FilterProvider>
  );
}
