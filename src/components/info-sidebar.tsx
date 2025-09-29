import { Info, BarChart3, Download, MapPin } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"

// Information menu items.
const infoItems = [
  {
    title: "Location Info",
    url: "#",
    icon: MapPin,
  },
  {
    title: "Data Analytics",
    url: "#",
    icon: BarChart3,
  },
  {
    title: "Export Data",
    url: "#",
    icon: Download,
  },
  {
    title: "About",
    url: "#",
    icon: Info,
  },
]

export function InfoSidebar() {
  return (
    <Sidebar variant="sidebar" collapsible="offcanvas" side="right">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Information</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {infoItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Data Summary</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border">
                  <div className="font-medium text-blue-900 dark:text-blue-100">Pedestrians</div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">1,234</div>
                </div>
                <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border">
                  <div className="font-medium text-green-900 dark:text-green-100">Vehicles</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">567</div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="h-32 bg-muted rounded-lg flex items-center justify-center border">
                  <span className="text-muted-foreground text-sm">Chart placeholder</span>
                </div>
              </div>

              <Button variant="outline" className="w-full">
                <Download className="w-4 h-4 mr-2" />
                Export Data
              </Button>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
