"use client";

import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";

const formSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  link: z.string().min(1, { message: "Link is required" }),
});

export default function AddRecipe() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      link: "",
    },
  });

  const addRecipeToBeCrawledMutation = useMutation(
    api.recipesNotYetCrawled.addRecipeToBeCrawled,
  );

  function onSubmit(values: z.infer<typeof formSchema>) {
    addRecipeToBeCrawledMutation({
      name: values.name,
      link: values.link,
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Recipe name" {...field} />
              </FormControl>
              <FormDescription>This is the name of the recipe.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="link"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Link</FormLabel>
              <FormControl>
                <Input placeholder="Recipe link" {...field} />
              </FormControl>
              <FormDescription>This is the link to the recipe.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
}
