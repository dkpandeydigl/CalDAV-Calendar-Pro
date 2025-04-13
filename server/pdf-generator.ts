import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { EventInvitationData, Attendee, Resource } from './email-service';

/**
 * Generates a well-formatted PDF with meeting/event details.
 * @param data The event invitation data
 * @returns A Buffer containing the generated PDF
 */
export async function generateEventAgendaPDF(data: EventInvitationData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Create a PDF document
      const doc = new PDFDocument({
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        size: 'A4',
        info: {
          Title: `Meeting Agenda: ${data.title}`,
          Author: data.organizer.name || data.organizer.email,
          Subject: 'Meeting Agenda',
          Keywords: 'meeting, calendar, agenda'
        }
      });

      // Create a buffer to store the PDF
      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // Helper functions for formatting
      const addHorizontalLine = () => {
        doc.strokeColor('#cccccc')
          .lineWidth(1)
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .stroke();
      };

      const formatDate = (date: Date) => {
        const dateFormat = new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          timeZoneName: 'short'
        });
        
        return dateFormat.format(date);
      };

      // Add logo or header image (if available)
      // You could add a company logo or header image here
      // doc.image('path/to/logo.png', {
      //   fit: [150, 150],
      //   align: 'center',
      // });

      // Document title
      doc.font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#333333')
        .text('MEETING AGENDA', { align: 'center' });

      doc.moveDown(0.5);
      
      // Meeting title
      doc.font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#000000')
        .text(data.title, { align: 'center' });
      
      doc.moveDown(1);

      // Basic meeting information section
      doc.font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#333333')
        .text('MEETING DETAILS', { underline: true });
      
      doc.moveDown(0.5);

      // Two-column layout for date/time and location information
      const startY = doc.y;
      
      // Left column - Date and Time
      doc.font('Helvetica-Bold')
        .fontSize(10)
        .text('Date & Time:', { continued: true })
        .font('Helvetica')
        .text(` ${formatDate(data.startDate)}`);
      
      doc.moveDown(0.3);
      
      doc.font('Helvetica-Bold')
        .fontSize(10)
        .text('Duration:', { continued: true })
        .font('Helvetica');
      
      // Calculate duration
      const durationMs = data.endDate.getTime() - data.startDate.getTime();
      const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
      const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (durationHours > 0) {
        doc.text(` ${durationHours} hour${durationHours !== 1 ? 's' : ''}`);
        if (durationMinutes > 0) {
          doc.text(` ${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}`);
        }
      } else {
        doc.text(` ${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}`);
      }

      // Reset position for right column
      doc.moveUp(1.3);
      doc.x = 300;
      
      // Right column - Location and organizer
      if (data.location) {
        doc.font('Helvetica-Bold')
          .fontSize(10)
          .text('Location:', { continued: true })
          .font('Helvetica')
          .text(` ${data.location}`);
        
        doc.moveDown(0.3);
      }
      
      doc.font('Helvetica-Bold')
        .fontSize(10)
        .text('Organizer:', { continued: true })
        .font('Helvetica')
        .text(` ${data.organizer.name || data.organizer.email}`);
      
      // Reset position after the two column layout
      doc.x = 50;
      doc.moveDown(1.5);
      
      // Add a divider
      addHorizontalLine();
      doc.moveDown(1);
      
      // Attendees section
      if (data.attendees && data.attendees.length > 0) {
        doc.font('Helvetica-Bold')
          .fontSize(12)
          .fillColor('#333333')
          .text('ATTENDEES', { underline: true });
        
        doc.moveDown(0.5);
        
        // Create attendee list
        data.attendees.forEach((attendee: Attendee, index: number) => {
          const displayName = attendee.name || attendee.email.split('@')[0];
          const role = attendee.role ? ` (${attendee.role})` : '';
          const status = attendee.status ? ` - ${attendee.status}` : '';
          
          doc.font('Helvetica')
            .fontSize(10)
            .text(`${index + 1}. ${displayName}${role}${status}`, {
              bulletPoint: true,
              bulletRadius: 2
            });
        });
        
        doc.moveDown(1);
      }
      
      // Resources section
      if (data.resources && data.resources.length > 0) {
        doc.font('Helvetica-Bold')
          .fontSize(12)
          .fillColor('#333333')
          .text('RESOURCES', { underline: true });
        
        doc.moveDown(0.5);
        
        // Create resources list
        data.resources.forEach((resource: Resource, index: number) => {
          doc.font('Helvetica')
            .fontSize(10)
            .text(`${index + 1}. ${resource.subType}${resource.capacity ? ` (Capacity: ${resource.capacity})` : ''}`, {
              bulletPoint: true,
              bulletRadius: 2
            });
            
          if (resource.remarks) {
            doc.font('Helvetica-Oblique')
              .fontSize(9)
              .text(`   Note: ${resource.remarks}`, { indent: 10 });
          }
        });
        
        doc.moveDown(1);
      }
      
      // Add another divider
      addHorizontalLine();
      doc.moveDown(1);
      
      // Meeting description/agenda
      doc.font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#333333')
        .text('AGENDA / DESCRIPTION', { underline: true });
      
      doc.moveDown(0.5);
      
      if (data.description) {
        // Convert HTML-like formatting to plain text with basic formatting
        const description = data.description
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/?p>/gi, '\n')
          .replace(/<\/?div>/gi, '\n')
          .replace(/<li>/gi, '• ')
          .replace(/<\/li>/gi, '\n')
          .replace(/<\/?(ul|ol)>/gi, '\n')
          .replace(/<[^>]*>/g, '');  // Remove any remaining HTML tags
        
        doc.font('Helvetica')
          .fontSize(10)
          .fillColor('#333333')
          .text(description.trim(), {
            align: 'left',
            paragraphGap: 5
          });
      } else {
        doc.font('Helvetica-Oblique')
          .fontSize(10)
          .fillColor('#666666')
          .text('No agenda or description provided.', { align: 'left' });
      }
      
      // Footer with page number
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        
        // Save the current position
        const currentY = doc.y;
        
        // Move to the bottom of the page
        doc.fontSize(8)
          .fillColor('#999999')
          .text(
            `Generated on ${new Date().toLocaleString()} | Page ${i + 1} of ${pageCount}`,
            50,
            doc.page.height - 50,
            { align: 'center' }
          );
        
        // Restore the position
        doc.y = currentY;
      }
      
      // Finalize the PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}