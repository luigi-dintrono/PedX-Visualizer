import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { FilterSidebar } from "@/components/filter-sidebar"
import { InfoSidebar } from "@/components/info-sidebar"
import { FilterProvider } from "@/contexts/FilterContext"
import Globe from "@/components/Globe";

export default function Home() {
  return (
    <FilterProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          {/* Left Filter Sidebar - Pushes Content */}
          <FilterSidebar />
          
          {/* Main Content Area */}
          <SidebarInset className="flex-1 flex flex-col">
            {/* Top Bar with Sidebar Triggers */}
            <div className="h-12 border-b flex items-center justify-between px-4">
              <div className="flex items-center">
                <SidebarTrigger />
                <h1 className="ml-4 text-lg font-semibold">PedX Visualizer</h1>
              </div>
              <SidebarTrigger />
            </div>
            
            {/* Cesium Globe - Takes remaining space */}
            <div className="flex-1 relative overflow-hidden">
              <Globe />
            </div>
          </SidebarInset>

          {/* Right Info Sidebar - Pushes Content */}
          <InfoSidebar />
        </div>
      </SidebarProvider>
    </FilterProvider>
  );
}
