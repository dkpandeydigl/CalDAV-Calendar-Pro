import { Router, Express } from 'express';
import { storage } from './storage';
import { User } from '@shared/schema';

// Create a router for user lookup endpoints
const userLookupRouter = Router();

// Endpoint to get user details by IDs for owner lookup
userLookupRouter.get('/details', async (req, res) => {
  try {
    // Get comma-separated list of user IDs from query parameter
    const userIds = req.query.ids ? String(req.query.ids).split(',').map(id => parseInt(id.trim(), 10)) : [];
    
    if (!userIds.length) {
      return res.status(400).json({ error: "Missing or invalid user IDs" });
    }
    
    // Filter out any invalid IDs
    const validUserIds = userIds.filter(id => !isNaN(id));
    
    if (!validUserIds.length) {
      return res.status(400).json({ error: "No valid user IDs provided" });
    }
    
    console.log(`Fetching user details for ${validUserIds.length} user IDs:`, validUserIds);
    
    // Fetch user details for each valid ID
    const userDetails = await Promise.all(
      validUserIds.map(async (userId) => {
        try {
          const user = await storage.getUser(userId);
          
          // Return minimal user info needed for display
          return user ? {
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.fullName || user.username // Use fullName as displayName or fall back to username
          } : { id: userId, username: `User ${userId}`, email: null }; 
        } catch (error) {
          console.error(`Error fetching user ${userId}:`, error);
          return { id: userId, username: `User ${userId}`, email: null };
        }
      })
    );
    
    console.log(`Successfully retrieved ${userDetails.length} user details`);
    res.json(userDetails);
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

export function registerUserLookupRoutes(app: Express) {
  app.use('/api/users', userLookupRouter);
  console.log("User lookup endpoints registered");
}