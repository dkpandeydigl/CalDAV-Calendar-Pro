import { Router, Express } from 'express';
import { storage } from './storage';
import { User } from '@shared/schema';

// Create a router for user lookup endpoints
const userLookupRouter = Router();

// Endpoint to get user details by IDs for owner lookup
userLookupRouter.get('/details', async (req, res) => {
  try {
    console.log("User details request received with query:", req.query);
    
    // Get comma-separated list of user IDs from query parameter
    const userIds = req.query.ids ? String(req.query.ids).split(',').map(id => parseInt(id.trim(), 10)) : [];
    
    console.log("Parsed user IDs:", userIds);
    
    // Even if we don't have IDs, return an empty array rather than an error
    // This allows the client to have a consistent response type
    if (!userIds.length) {
      console.log("No user IDs provided, returning empty array");
      return res.json([]);
    }
    
    // Filter out any invalid IDs
    const validUserIds = userIds.filter(id => !isNaN(id) && id > 0);
    
    if (!validUserIds.length) {
      console.log("No valid user IDs found, returning empty array");
      return res.json([]);
    }
    
    console.log(`Fetching user details for ${validUserIds.length} user IDs:`, validUserIds);
    
    // Fetch user details for each valid ID
    const userDetails = await Promise.all(
      validUserIds.map(async (userId) => {
        try {
          const user = await storage.getUser(userId);
          
          if (!user) {
            console.log(`User ${userId} not found, creating placeholder`);
            return { 
              id: userId, 
              username: `user${userId}@example.com`,
              email: `user${userId}@example.com`
            };
          }
          
          // Return minimal user info needed for display
          const userInfo = {
            id: user.id,
            username: user.username,
            email: user.email || user.username,
            displayName: user.fullName || user.username
          };
          
          console.log(`User ${userId} details:`, userInfo);
          return userInfo;
        } catch (error) {
          console.error(`Error fetching user ${userId}:`, error);
          return { 
            id: userId, 
            username: `user${userId}@example.com`, 
            email: `user${userId}@example.com` 
          };
        }
      })
    );
    
    console.log(`Successfully retrieved ${userDetails.length} user details`);
    res.json(userDetails);
  } catch (error) {
    console.error("Error fetching user details:", error);
    // Return an empty array instead of error to maintain client expectations
    res.json([]);
  }
});

export function registerUserLookupRoutes(app: Express) {
  app.use('/api/users', userLookupRouter);
  console.log("User lookup endpoints registered");
}