"use client";

import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useRouter } from "next/navigation"
import { createSavedNotePath } from "@/lib/savedNoteRoute";




export const useNavigation = (meetingId: string, meetingTitle: string) => {
    const router = useRouter();
    const { setCurrentMeeting } = useSidebar();

    const handleNavigation = () => {
        setCurrentMeeting({ id: meetingId, title: meetingTitle });
        router.push(createSavedNotePath(meetingId));
    };

    return handleNavigation;
};
